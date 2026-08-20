import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildApp } from "../apps/server/src/app.js";
import type { ServerConfig } from "../apps/server/src/config.js";

const workspace = mkdtempSync(join(tmpdir(), "narrative-e2e-"));
const dataDirectory = join(workspace, "data");
const port = Number(process.env.NARRATIVE_E2E_API_PORT ?? 14317);
const config: ServerConfig = {
  dataDirectory,
  databasePath: join(dataDirectory, "narralume.sqlite"),
  backupDirectory: join(workspace, "backups"),
  backupRetention: 4,
  host: "127.0.0.1",
  port,
  environment: "test",
};
const app = await buildApp({
  config,
  enableRunWorker: false,
  logger: false,
});
await app.listen({ host: config.host, port: config.port });

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  rmSync(workspace, { recursive: true, force: true });
}

process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));
