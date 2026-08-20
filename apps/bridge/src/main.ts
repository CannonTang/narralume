import { buildBridge } from "./app.js";
import { readBridgeConfig } from "./config.js";

const config = readBridgeConfig();
const app = buildBridge({ config });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down bridge");
  await app.close();
  process.exitCode = 0;
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
}
