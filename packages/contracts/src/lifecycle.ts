import { z } from "zod";

export const SystemBackupManifestSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  databaseFile: z.string(),
  createdAt: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  migration: z.number().int().nonnegative(),
  pageCount: z.number().int().nonnegative(),
  projectCount: z.number().int().nonnegative(),
});
export type SystemBackupManifestDto = z.infer<
  typeof SystemBackupManifestSchema
>;

export const SystemBackupPreviewSchema = z.object({
  manifest: SystemBackupManifestSchema,
  valid: z.boolean(),
  hashMatches: z.boolean(),
  integrityCheck: z.string(),
  foreignKeyViolations: z.number().int().nonnegative(),
  counts: z.object({
    projects: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
    versions: z.number().int().nonnegative(),
    canonFacts: z.number().int().nonnegative(),
    runs: z.number().int().nonnegative(),
  }),
});
export type SystemBackupPreviewDto = z.infer<typeof SystemBackupPreviewSchema>;

export const CreateSystemBackupRequestSchema = z.object({
  label: z.string().trim().min(1).max(200).default("手动完整备份"),
});

export const RestoreSystemBackupRequestSchema = z.object({
  targetDirectory: z.string().trim().min(1).max(2_000),
  overwrite: z.boolean().default(false),
});

export const SystemBackupRestoreResultSchema = z.object({
  targetDirectory: z.string(),
  databasePath: z.string(),
  sha256: z.string(),
  migration: z.number().int().nonnegative(),
  counts: SystemBackupPreviewSchema.shape.counts,
});
