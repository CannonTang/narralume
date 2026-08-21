import { NodeNarrativeDatabase } from "@narralume/persistence/node";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

describe("server exposure boundary", () => {
  const openApps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(openApps.splice(0).map((app) => app.close()));
  });

  it("refuses non-loopback production listening without explicit auth", async () => {
    await expect(
      buildApp({
        config: config({ host: "0.0.0.0", environment: "production" }),
        database: new NodeNarrativeDatabase(),
        enableRunWorker: false,
        logger: false,
      }),
    ).rejects.toThrow(/NARRATIVE_ALLOW_REMOTE/u);
  });

  it("requires a bearer token when configured and emits browser hardening headers", async () => {
    const app = await buildApp({
      config: config({
        authToken: "a-secure-token-with-at-least-24-characters",
      }),
      database: new NodeNarrativeDatabase(),
      enableRunWorker: false,
      logger: false,
    });
    openApps.push(app);
    expect(
      (await app.inject({ method: "GET", url: "/api/health" })).statusCode,
    ).toBe(200);
    const unauthorized = await app.inject({
      method: "GET",
      url: "/api/projects",
    });
    expect(unauthorized.statusCode).toBe(401);
    const authorized = await app.inject({
      method: "GET",
      url: "/api/projects",
      headers: {
        authorization: "Bearer a-secure-token-with-at-least-24-characters",
      },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.headers["x-frame-options"]).toBe("DENY");
    expect(authorized.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(authorized.headers["permissions-policy"]).toContain("camera=()");
  });

  it("allows explicit authenticated remote production configuration", async () => {
    const app = await buildApp({
      config: config({
        host: "0.0.0.0",
        environment: "production",
        allowRemote: true,
        authToken: "a-secure-token-with-at-least-24-characters",
      }),
      database: new NodeNarrativeDatabase(),
      enableRunWorker: false,
      logger: false,
    });
    openApps.push(app);
    expect(app).toBeDefined();
  });
});

function config(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    dataDirectory: ".tmp/test-security",
    databasePath: ":memory:",
    host: "127.0.0.1",
    port: 4317,
    environment: "test",
    ...overrides,
  };
}
