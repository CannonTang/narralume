import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeNarrativeDatabase } from "@narrative-lantern/persistence/node";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

/* M4 可选静态托管：NARRATIVE_STATIC_DIR 一个开关——
 * 静态产物 + SPA 回落 index.html；/api 未知路径仍是 JSON 404。 */

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
const dirs: string[] = [];

afterEach(async () => {
  while (apps.length > 0) await (await apps.pop())?.close();
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function makeStaticDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "narrative-static-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>灯</title>");
  writeFileSync(join(dir, "spike.html"), "<!doctype html><title>spike</title>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "app.js"), "console.log('app')");
  return dir;
}

const baseConfig = (staticDirectory?: string): ServerConfig => ({
  dataDirectory: ".",
  databasePath: ":memory:",
  ...(staticDirectory ? { staticDirectory } : {}),
  host: "127.0.0.1",
  port: 4317,
  environment: "test",
});

describe("可选静态托管（NARRATIVE_STATIC_DIR）", () => {
  it("静态文件、assets 与 SPA 回落 index.html 均可访问", async () => {
    const app = await buildApp({
      config: baseConfig(makeStaticDir()),
      database: new NodeNarrativeDatabase(),
      enableRunWorker: false,
      logger: false,
    });
    apps.push(app);
    const index = await app.inject({ method: "GET", url: "/" });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain("灯");
    expect(index.headers["content-security-policy"]).toContain(
      "script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com",
    );
    expect(index.headers["content-security-policy"]).toContain(
      "frame-src https://challenges.cloudflare.com",
    );
    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("console.log");
    // SPA 深链回落 index.html（前端路由 /shelf、/projects/x/overview）。
    const deep = await app.inject({ method: "GET", url: "/shelf" });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain("灯");
  });

  it("/api 未知路径仍返回 JSON 404，不回落 index.html", async () => {
    const app = await buildApp({
      config: baseConfig(makeStaticDir()),
      database: new NodeNarrativeDatabase(),
      enableRunWorker: false,
      logger: false,
    });
    apps.push(app);
    const api = await app.inject({
      method: "GET",
      url: "/api/definitely-missing",
    });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toMatchObject({ error: { code: "route.not_found" } });
    expect(api.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
  });

  it("未配置开关时行为不变：未知路径 JSON 404", async () => {
    const app = await buildApp({
      config: baseConfig(),
      database: new NodeNarrativeDatabase(),
      enableRunWorker: false,
      logger: false,
    });
    apps.push(app);
    const missing = await app.inject({ method: "GET", url: "/shelf" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      error: { code: "route.not_found" },
    });
  });
});
