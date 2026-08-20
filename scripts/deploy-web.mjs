#!/usr/bin/env node
/**
 * Cloudflare Workers Static Assets 在线体验站部署。
 *
 * VITE_* 会在 Vite 构建时内联，必须传给构建子进程；Wrangler 运行时变量
 * 不能替代这一步。
 */
import { spawnSync } from "node:child_process";

const relayUrl = process.env.VITE_DEMO_RELAY_URL?.trim() ?? "";
const relayModel = process.env.VITE_DEMO_RELAY_MODEL?.trim() ?? "";
if (relayUrl && !relayModel) {
  throw new Error(
    "VITE_DEMO_RELAY_MODEL is required when VITE_DEMO_RELAY_URL is set.",
  );
}
const env = {
  ...process.env,
  VITE_DEMO_RELAY_URL: relayUrl,
  VITE_DEMO_RELAY_MODEL: relayModel,
  VITE_TRIAL_MODE: process.env.VITE_TRIAL_MODE ?? (relayUrl ? "1" : "0"),
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(
  `[deploy-web] VITE_DEMO_RELAY_URL=${env.VITE_DEMO_RELAY_URL} VITE_DEMO_RELAY_MODEL=${env.VITE_DEMO_RELAY_MODEL} VITE_TRIAL_MODE=${env.VITE_TRIAL_MODE}`,
);
run("npm", ["run", "build"], { env });
run("npx", ["wrangler", "deploy", "--config", "apps/web/wrangler.toml"]);
