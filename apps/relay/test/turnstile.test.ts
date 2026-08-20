import { describe, expect, it, vi } from "vitest";

import { validateTurnstile } from "../src/turnstile.js";

const input = {
  expectedAction: "trial-session",
  expectedHostname: "demo.example.com",
  remoteIp: "203.0.113.1",
  secret: "secret",
  token: "token",
};

describe("Turnstile 服务端验证", () => {
  it("同时校验成功、hostname 与 action", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        success: true,
        hostname: "demo.example.com",
        action: "trial-session",
      }),
    );

    await expect(validateTurnstile({ ...input, fetcher })).resolves.toBe(
      "valid",
    );
    const sent = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(sent).toMatchObject({
      secret: "secret",
      response: "token",
      remoteip: "203.0.113.1",
    });
  });

  it("拒绝错误 hostname 或 action", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        success: true,
        hostname: "attacker.example",
        action: "trial-session",
      }),
    );
    await expect(validateTurnstile({ ...input, fetcher })).resolves.toBe(
      "invalid",
    );
  });

  it("把网络故障视为验证服务不可用", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(validateTurnstile({ ...input, fetcher })).resolves.toBe(
      "unavailable",
    );
  });
});
