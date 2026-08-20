import type { RouteApp } from "@narrative-lantern/services";
import {
  CreateSystemBackupRequestSchema,
  RestoreSystemBackupRequestSchema,
  SystemBackupManifestSchema,
  SystemBackupPreviewSchema,
  SystemBackupRestoreResultSchema,
} from "@narrative-lantern/contracts";
import type { NarrativeDatabase } from "@narrative-lantern/persistence";
import { z } from "zod";

import type { ServerConfig } from "./config.js";
import { DatabaseBackupService } from "./database-backup-service.js";

const BackupParamsSchema = z.object({ backupId: z.string().uuid() });

export function registerSystemBackupRoutes(
  app: RouteApp,
  database: NarrativeDatabase,
  config: ServerConfig,
) {
  if (database.path === ":memory:") return null;
  const service = new DatabaseBackupService(
    database,
    config.backupDirectory ?? `${config.dataDirectory}/backups`,
    config.backupRetention ?? 10,
  );

  app.route("GET", "/api/system/backups", async () =>
    service
      .list()
      .map((manifest) => SystemBackupManifestSchema.parse(manifest)),
  );

  app.route("POST", "/api/system/backups", async (request) => {
    const input = CreateSystemBackupRequestSchema.parse(request.body ?? {});
    const manifest = await service.create(
      input.label,
      new Date().toISOString(),
    );
    return { status: 201, body: SystemBackupManifestSchema.parse(manifest) };
  });

  app.route("GET", "/api/system/backups/:backupId/preview", async (request) => {
    const { backupId } = BackupParamsSchema.parse(request.params);
    return SystemBackupPreviewSchema.parse(await service.preview(backupId));
  });

  app.route(
    "POST",
    "/api/system/backups/:backupId/restore",
    async (request) => {
      const { backupId } = BackupParamsSchema.parse(request.params);
      const input = RestoreSystemBackupRequestSchema.parse(request.body);
      return {
        status: 201,
        body: SystemBackupRestoreResultSchema.parse(
          await service.restore(
            backupId,
            input.targetDirectory,
            input.overwrite,
          ),
        ),
      };
    },
  );
  return service;
}
