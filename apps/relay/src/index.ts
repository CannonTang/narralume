import {
  decideRelay,
  responseHeadersForRelay,
  type RelayEnv,
} from "./relay-core.js";
import {
  issueSession,
  isValidSessionSigningKey,
  sessionCookie,
  sessionFromCookie,
  verifySession,
} from "./session.js";
import { consumeSessionQuota, SessionQuota } from "./session-quota.js";
import { validateTurnstile } from "./turnstile.js";

interface RateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  UPSTREAM_BASE_URL: string;
  RELAY_MODEL: string;
  WEB_ORIGIN: string;
  BRIDGE_ACCESS_CLIENT_ID: string;
  BRIDGE_ACCESS_CLIENT_SECRET: string;
  BRIDGE_SHARED_SECRET: string;
  SESSION_SIGNING_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  RATE_LIMITER: RateLimiter;
  SESSION_QUOTAS: DurableObjectNamespace;
}

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  if (!allowedOrigin) return {};
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, accept",
    "access-control-allow-credentials": "true",
    "access-control-expose-headers":
      "x-trial-quota-limit, x-trial-quota-remaining, x-trial-quota-reset, retry-after",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function allowedOrigin(request: Request, env: Env): string | null {
  return request.headers.get("origin") === env.WEB_ORIGIN
    ? env.WEB_ORIGIN
    : null;
}

function requestCountry(request: Request): string | null {
  return (
    (request as Request & { cf?: { country?: string | null } }).cf?.country ??
    null
  );
}

function reject(
  status: number,
  body: { code: string; message: string },
  origin: string | null,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...corsHeaders(origin),
      ...extraHeaders,
    },
  });
}

function configured(env: Env): boolean {
  return Boolean(
    env.UPSTREAM_BASE_URL &&
    env.RELAY_MODEL &&
    env.BRIDGE_ACCESS_CLIENT_ID &&
    env.BRIDGE_ACCESS_CLIENT_SECRET &&
    env.BRIDGE_SHARED_SECRET &&
    isValidSessionSigningKey(env.SESSION_SIGNING_KEY) &&
    env.TURNSTILE_SECRET_KEY,
  );
}

async function admitted(env: Env, key: string): Promise<boolean> {
  return (await env.RATE_LIMITER.limit({ key })).success;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request, env);
    if (request.method === "OPTIONS") {
      if (!origin) {
        return reject(
          403,
          {
            code: "origin_not_allowed",
            message: "请求来源不在允许列表内。",
          },
          null,
        );
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.headers.has("origin") && !origin) {
      return reject(
        403,
        {
          code: "origin_not_allowed",
          message: "请求来源不在允许列表内。",
        },
        null,
      );
    }
    const url = new URL(request.url);
    if (!configured(env)) {
      return reject(
        503,
        { code: "relay_not_configured", message: "中继尚未完成安全配置。" },
        origin,
      );
    }

    const clientIp = request.headers.get("cf-connecting-ip");
    if (url.pathname === "/session" && request.method === "GET") {
      const valid = await verifySession(
        sessionFromCookie(request.headers.get("cookie")),
        env.SESSION_SIGNING_KEY,
        clientIp ?? "unknown-client",
      );
      if (valid) {
        return new Response(null, {
          status: 204,
          headers: corsHeaders(origin),
        });
      }
      if (requestCountry(request) === "CN") {
        if (
          !(await admitted(env, `challenge:${clientIp ?? "unknown-client"}`))
        ) {
          return reject(
            429,
            { code: "rate_limited", message: "请求过于频繁，请稍后再试。" },
            origin,
          );
        }
        const session = await issueSession(
          env.SESSION_SIGNING_KEY,
          clientIp ?? "unknown-client",
        );
        return new Response(null, {
          status: 204,
          headers: {
            ...corsHeaders(origin),
            "cache-control": "no-store",
            "set-cookie": sessionCookie(session),
          },
        });
      }
      return reject(
        401,
        { code: "session_required", message: "需要完成人机验证。" },
        origin,
      );
    }

    if (url.pathname === "/session" && request.method === "POST") {
      if (!(await admitted(env, `challenge:${clientIp ?? "unknown-client"}`))) {
        return reject(
          429,
          { code: "rate_limited", message: "请求过于频繁，请稍后再试。" },
          origin,
        );
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return reject(
          400,
          { code: "invalid_json", message: "请求体必须是 JSON。" },
          origin,
        );
      }
      const token =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>).token
          : null;
      if (
        typeof token !== "string" ||
        token.length === 0 ||
        token.length > 2_048
      ) {
        return reject(
          400,
          { code: "invalid_turnstile_token", message: "人机验证令牌无效。" },
          origin,
        );
      }
      const validation = await validateTurnstile({
        expectedAction: "trial-session",
        expectedHostname: new URL(env.WEB_ORIGIN).hostname,
        remoteIp: clientIp,
        secret: env.TURNSTILE_SECRET_KEY,
        token,
      });
      if (validation === "unavailable") {
        return reject(
          502,
          {
            code: "turnstile_unavailable",
            message: "人机验证服务暂时不可用。",
          },
          origin,
        );
      }
      if (validation === "invalid") {
        return reject(
          401,
          { code: "turnstile_rejected", message: "人机验证未通过，请重试。" },
          origin,
        );
      }
      const session = await issueSession(
        env.SESSION_SIGNING_KEY,
        clientIp ?? "unknown-client",
      );
      return new Response(null, {
        status: 204,
        headers: {
          ...corsHeaders(origin),
          "cache-control": "no-store",
          "set-cookie": sessionCookie(session),
        },
      });
    }

    if (request.method !== "POST") {
      return reject(
        405,
        { code: "method_not_allowed", message: "该接口只接受 POST 请求。" },
        origin,
      );
    }

    if (url.pathname !== "/v1/chat/completions") {
      return reject(
        404,
        { code: "path_not_allowed", message: "该接口不在公开白名单内。" },
        origin,
      );
    }
    const session = await verifySession(
      sessionFromCookie(request.headers.get("cookie")),
      env.SESSION_SIGNING_KEY,
      clientIp ?? "unknown-client",
    );
    if (!session) {
      return reject(
        401,
        { code: "session_required", message: "需要完成人机验证。" },
        origin,
      );
    }
    if (!(await admitted(env, `model:${session.id}`))) {
      return reject(
        429,
        { code: "rate_limited", message: "请求过于频繁，请稍后再试。" },
        origin,
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return reject(
        400,
        { code: "invalid_json", message: "请求体必须是 JSON。" },
        origin,
      );
    }
    const relayEnv: RelayEnv = {
      upstreamBaseUrl: env.UPSTREAM_BASE_URL,
      model: env.RELAY_MODEL,
      bridgeAccessClientId: env.BRIDGE_ACCESS_CLIENT_ID,
      bridgeAccessClientSecret: env.BRIDGE_ACCESS_CLIENT_SECRET,
      bridgeSharedSecret: env.BRIDGE_SHARED_SECRET,
    };
    const decision = decideRelay(relayEnv, {
      method: request.method,
      url: url.pathname + url.search,
      body,
    });
    if (decision.action === "reject") {
      return reject(
        decision.status,
        { code: decision.code, message: decision.message },
        origin,
      );
    }

    let quota;
    try {
      quota = await consumeSessionQuota(env.SESSION_QUOTAS, session);
    } catch {
      return reject(
        503,
        { code: "quota_unavailable", message: "体验额度服务暂时不可用。" },
        origin,
      );
    }
    const quotaHeaders = {
      "x-trial-quota-limit": String(quota.limit),
      "x-trial-quota-remaining": String(quota.remaining),
      "x-trial-quota-reset": String(quota.resetAt),
    };
    if (!quota.allowed) {
      return reject(
        429,
        {
          code: "session_quota_exhausted",
          message: "本次体验会话的 60 次模型调用额度已用完。",
        },
        origin,
        {
          ...quotaHeaders,
          "retry-after": String(
            Math.max(1, quota.resetAt - Math.floor(Date.now() / 1_000)),
          ),
        },
      );
    }

    const controller = new AbortController();
    // 在线体验允许模型较慢地返回首个响应片段；Bridge 和模型客户端仍有各自的更长时限。
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let upstream: Response;
    try {
      upstream = await fetch(decision.upstreamUrl, {
        method: "POST",
        headers: decision.headers,
        body: JSON.stringify(decision.body),
        signal: controller.signal,
      });
    } catch (error) {
      return reject(
        error instanceof DOMException && error.name === "AbortError"
          ? 504
          : 502,
        {
          code:
            error instanceof DOMException && error.name === "AbortError"
              ? "bridge_timeout"
              : "bridge_unavailable",
          message:
            error instanceof DOMException && error.name === "AbortError"
              ? "模型服务响应超时。"
              : "模型服务暂时不可用。",
        },
        origin,
        quotaHeaders,
      );
    } finally {
      clearTimeout(timeout);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...responseHeadersForRelay(upstream.headers.entries(), origin),
        ...quotaHeaders,
      },
    });
  },
};

export { SessionQuota };
