import { describe, expect, it } from "vitest";

import {
  decideRelay,
  responseHeadersForRelay,
  type RelayEnv,
  type RelayRequestContext,
} from "../src/relay-core.js";

const env: RelayEnv = {
  upstreamBaseUrl: "https://bridge.example/v1",
  model: "example-model",
  bridgeAccessClientId: "access-client-id",
  bridgeAccessClientSecret: "access-client-secret",
  bridgeSharedSecret: "bridge-shared-secret",
};

function request(
  overrides: Partial<RelayRequestContext> = {},
): RelayRequestContext {
  return {
    method: "POST",
    url: "/v1/chat/completions",
    body: {
      model: "client-selected-model",
      stream: true,
      messages: [{ role: "user", content: "继续" }],
    },
    ...overrides,
  };
}

describe("公网 Relay 白名单", () => {
  it("只放行 Chat Completions", () => {
    expect(decideRelay(env, request()).action).toBe("forward");
    for (const url of [
      "/v1/responses",
      "/v1/messages",
      "/v1/embeddings",
      "/v1/models",
      "/admin",
    ]) {
      expect(decideRelay(env, request({ url }))).toMatchObject({
        action: "reject",
        status: 404,
        code: "path_not_allowed",
      });
    }
  });

  it("拒绝非 POST 与非对象请求体", () => {
    expect(decideRelay(env, request({ method: "GET" }))).toMatchObject({
      action: "reject",
      status: 405,
      code: "method_not_allowed",
    });
    expect(decideRelay(env, request({ body: [] }))).toMatchObject({
      action: "reject",
      status: 400,
      code: "invalid_body",
    });
  });

  it("强制模型并只注入 Bridge 凭据", () => {
    const decision = decideRelay(env, request());
    expect(decision.action).toBe("forward");
    if (decision.action !== "forward") return;

    expect(decision.upstreamUrl).toBe(
      "https://bridge.example/v1/chat/completions",
    );
    expect(decision.body).toMatchObject({
      model: "example-model",
      stream: true,
    });
    expect(decision.headers).toEqual({
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "cf-access-client-id": "access-client-id",
      "cf-access-client-secret": "access-client-secret",
      "x-narrative-bridge-token": "bridge-shared-secret",
    });
    expect(decision.headers.authorization).toBeUndefined();
    expect(JSON.stringify(decision)).not.toContain("client-selected-model");
  });
});

describe("Relay 响应头", () => {
  it("只保留内容类型、请求 ID 和允许站点的 CORS", () => {
    const headers = responseHeadersForRelay(
      [
        ["content-type", "text/event-stream"],
        ["x-request-id", "req-42"],
        ["x-internal-provider", "must-not-leak"],
        ["set-cookie", "must-not-leak"],
      ],
      "https://demo.example.com",
    );

    expect(headers).toMatchObject({
      "content-type": "text/event-stream",
      "x-request-id": "req-42",
      "access-control-allow-origin": "https://demo.example.com",
      "access-control-allow-credentials": "true",
      "cache-control": "no-store",
    });
    expect(headers["x-internal-provider"]).toBeUndefined();
    expect(headers["set-cookie"]).toBeUndefined();
  });
});
