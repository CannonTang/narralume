import { describe, expect, it, vi } from "vitest";

import { SESSION_REQUEST_LIMIT, SessionQuota } from "../src/session-quota.js";

function durableState(initial?: { count: number; expiresAt: number }) {
  let stored = initial;
  const storage = {
    deleteAll: vi.fn(async () => {
      stored = undefined;
    }),
    get: vi.fn(async () => stored),
    put: vi.fn(async (_key: string, value: typeof initial) => {
      stored = value;
    }),
    setAlarm: vi.fn(async () => undefined),
    transaction: async <T>(
      callback: (transaction: typeof storage) => Promise<T>,
    ): Promise<T> => callback(storage),
  };
  return {
    state: { storage } as unknown as DurableObjectState,
    storage,
  };
}

describe("Relay 签名会话额度", () => {
  it("扣除一次调用并返回剩余额度", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const { state, storage } = durableState();
    const quota = new SessionQuota(state);
    const response = await quota.fetch(
      new Request("https://quota.internal/consume", {
        method: "POST",
        headers: { "x-session-expires-at": String(now + 3_600) },
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      allowed: true,
      limit: 60,
      remaining: 59,
    });
    expect(storage.put).toHaveBeenCalledWith("quota", {
      count: 1,
      expiresAt: now + 3_600,
    });
  });

  it("第 60 次后拒绝继续调用", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const expiresAt = now + 3_600;
    const { state, storage } = durableState({
      count: SESSION_REQUEST_LIMIT,
      expiresAt,
    });
    const quota = new SessionQuota(state);
    const response = await quota.fetch(
      new Request("https://quota.internal/consume", {
        method: "POST",
        headers: { "x-session-expires-at": String(expiresAt) },
      }),
    );

    await expect(response.json()).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("闹钟触发后清除过期计数", async () => {
    const { state, storage } = durableState({ count: 10, expiresAt: 1 });
    await new SessionQuota(state).alarm();
    expect(storage.deleteAll).toHaveBeenCalledOnce();
  });
});
