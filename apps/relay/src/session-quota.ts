import type { VerifiedSession } from "./session.js";

export const SESSION_REQUEST_LIMIT = 60;

interface StoredQuota {
  count: number;
  expiresAt: number;
}

export interface QuotaResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export class SessionQuota {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response(null, { status: 405 });

    const expiresAt = Number(request.headers.get("x-session-expires-at"));
    const now = Math.floor(Date.now() / 1_000);
    if (!Number.isInteger(expiresAt) || expiresAt <= now) {
      return Response.json({ code: "invalid_expiry" }, { status: 400 });
    }

    const result = await this.state.storage.transaction(async (transaction) => {
      const stored = await transaction.get<StoredQuota>("quota");
      const count = stored?.expiresAt === expiresAt ? stored.count : 0;
      if (count >= SESSION_REQUEST_LIMIT) {
        return {
          allowed: false,
          limit: SESSION_REQUEST_LIMIT,
          remaining: 0,
          resetAt: expiresAt,
        } satisfies QuotaResult;
      }

      const nextCount = count + 1;
      await transaction.put("quota", { count: nextCount, expiresAt });
      await this.state.storage.setAlarm(expiresAt * 1_000);
      return {
        allowed: true,
        limit: SESSION_REQUEST_LIMIT,
        remaining: SESSION_REQUEST_LIMIT - nextCount,
        resetAt: expiresAt,
      } satisfies QuotaResult;
    });

    return Response.json(result);
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}

export async function consumeSessionQuota(
  namespace: DurableObjectNamespace,
  session: VerifiedSession,
): Promise<QuotaResult> {
  const id = namespace.idFromName(session.id);
  const response = await namespace
    .get(id)
    .fetch("https://quota.internal/consume", {
      method: "POST",
      headers: { "x-session-expires-at": String(session.exp) },
    });
  if (!response.ok)
    throw new Error(`Session quota failed with ${response.status}`);
  return (await response.json()) as QuotaResult;
}
