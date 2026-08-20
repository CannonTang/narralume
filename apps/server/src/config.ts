import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

loadDotEnv({
  path: [
    resolve(process.cwd(), ".env.local"),
    resolve(repositoryRoot, ".env.local"),
  ],
  quiet: true,
});

const EnvironmentSchema = z.object({
  NARRATIVE_DATA_DIR: z.string().default("./data"),
  NARRATIVE_BACKUP_DIR: z.string().trim().optional(),
  NARRATIVE_BACKUP_RETENTION: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10),
  NARRATIVE_BACKUP_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(43_200)
    .default(360),
  NARRATIVE_BACKUP_ON_STARTUP: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  NARRATIVE_ALLOW_REMOTE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  NARRATIVE_AUTH_TOKEN: z.string().trim().min(24).optional(),
  NARRATIVE_STATIC_DIR: z.string().trim().optional(),
  NARRATIVE_SERVER_HOST: z.string().default("127.0.0.1"),
  NARRATIVE_SERVER_PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65_535)
    .default(4317),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export interface ServerConfig {
  dataDirectory: string;
  databasePath: string;
  backupDirectory?: string;
  backupRetention?: number;
  backupIntervalMinutes?: number;
  backupOnStartup?: boolean;
  allowRemote?: boolean;
  authToken?: string | null;
  staticDirectory?: string;
  host: string;
  port: number;
  environment: "development" | "test" | "production";
}

export function readServerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  workingDirectory = repositoryRoot,
): ServerConfig {
  const parsed = EnvironmentSchema.parse(environment);
  const dataDirectory = resolve(workingDirectory, parsed.NARRATIVE_DATA_DIR);
  return {
    dataDirectory,
    databasePath: resolve(dataDirectory, "narralume.sqlite"),
    ...(parsed.NARRATIVE_BACKUP_DIR
      ? {
          backupDirectory: resolve(
            workingDirectory,
            parsed.NARRATIVE_BACKUP_DIR,
          ),
        }
      : {}),
    backupRetention: parsed.NARRATIVE_BACKUP_RETENTION,
    backupIntervalMinutes: parsed.NARRATIVE_BACKUP_INTERVAL_MINUTES,
    backupOnStartup: parsed.NARRATIVE_BACKUP_ON_STARTUP,
    allowRemote: parsed.NARRATIVE_ALLOW_REMOTE,
    authToken: parsed.NARRATIVE_AUTH_TOKEN ?? null,
    ...(parsed.NARRATIVE_STATIC_DIR
      ? {
          staticDirectory: resolve(
            workingDirectory,
            parsed.NARRATIVE_STATIC_DIR,
          ),
        }
      : {}),
    host: parsed.NARRATIVE_SERVER_HOST,
    port: parsed.NARRATIVE_SERVER_PORT,
    environment: parsed.NODE_ENV,
  };
}
