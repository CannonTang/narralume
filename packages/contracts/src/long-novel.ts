import { z } from "zod";

const IdSchema = z.string().trim().min(1).max(300);
const TimestampSchema = z.string().min(1);

export const LONG_NOVEL_LIMITS = {
  predictionHorizon: 20,
  predictionCount: 5,
} as const;

export const RetrievalSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(20_000),
  entityIds: z.array(IdSchema).max(100).default([]),
  limit: z.number().int().min(1).max(50).default(12),
  rerank: z.boolean().default(true),
});

export const RetrievalHitSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  sourceType: z.string(),
  sourceId: z.string(),
  title: z.string(),
  content: z.string(),
  authority: z.enum(["reference", "draft", "candidate", "confirmed", "locked"]),
  metadata: z.record(z.string(), z.unknown()),
  entityIds: z.array(IdSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  lexicalRank: z.number().nullable(),
  vectorRank: z.number().int().nonnegative().nullable(),
  entityScore: z.number(),
  vectorScore: z.number(),
  rerankScore: z.number().nullable(),
  score: z.number(),
  reasons: z.array(z.enum(["fts", "entity", "vector", "rerank"])),
});
export type RetrievalHitDto = z.infer<typeof RetrievalHitSchema>;

export const NarrativeMemorySchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  layer: z.enum(["working", "episodic", "semantic"]),
  scopeType: z.string(),
  scopeId: z.string(),
  title: z.string(),
  content: z.string(),
  stateDelta: z.record(z.string(), z.unknown()),
  sourceHash: z.string(),
  status: z.enum(["active", "stale", "retired"]),
  refreshedAt: TimestampSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type NarrativeMemoryDto = z.infer<typeof NarrativeMemorySchema>;

export const PlotPredictionSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  title: z.string(),
  horizon: z.number().int().min(1).max(LONG_NOVEL_LIMITS.predictionHorizon),
  summary: z.string(),
  impact: z.array(z.string()),
  risks: z.array(z.string()),
  uncertainty: z.number().min(0).max(1),
  contextFingerprint: z.string().length(64),
  status: z.enum(["candidate", "adopted", "dismissed"]),
  stale: z.boolean(),
  sourceIds: z.array(z.string()),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type PlotPredictionDto = z.infer<typeof PlotPredictionSchema>;

export const GeneratePredictionsRequestSchema = z.object({
  direction: z.string().trim().max(10_000).default(""),
  horizon: z
    .number()
    .int()
    .min(1)
    .max(LONG_NOVEL_LIMITS.predictionHorizon)
    .default(3),
  count: z
    .number()
    .int()
    .min(2)
    .max(LONG_NOVEL_LIMITS.predictionCount)
    .default(3),
});

export const DecidePredictionRequestSchema = z.object({
  status: z.enum(["adopted", "dismissed"]),
});

export const DryRunRequestSchema = z.object({
  change: z.string().trim().min(1).max(30_000),
});

export const DryRunResultSchema = z.object({
  fingerprint: z.string().length(64),
  safeToProceed: z.boolean(),
  findings: z.array(
    z.object({
      kind: z.enum(["entity", "fact", "timeline", "foreshadow", "outline"]),
      sourceId: z.string(),
      label: z.string(),
      impact: z.string(),
      severity: z.enum(["info", "warning"]),
    }),
  ),
});
export type DryRunResultDto = z.infer<typeof DryRunResultSchema>;
