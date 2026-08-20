import { z } from "zod";

/** Canonical provider wire-API enum. */
export const WireApiSchema = z.enum([
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
]);
export type WireApi = z.infer<typeof WireApiSchema>;

export const ProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  wireApi: WireApiSchema,
  baseUrl: z.string().url(),
  endpoint: z.string().nullable(),
  /** Raw API key or an `env:NAME` reference. */
  credentialRef: z.string(),
  anthropicVersion: z.string().nullable(),
  headers: z.record(z.string(), z.string()),
  queryParams: z.record(z.string(), z.string()),
  requestStartTimeoutMs: z.number().int().positive().nullable(),
  streamIdleTimeoutMs: z.number().int().positive().nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProviderDto = z.infer<typeof ProviderSchema>;

export const UpsertProviderRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  wireApi: WireApiSchema,
  baseUrl: z.string().url(),
  endpoint: z.string().trim().max(300).nullable().default(null),
  // Accepts a raw API key or an `env:NAME` reference. Optional so that update
  // requests can omit it to keep the stored credential; the server requires
  // it when creating a new provider.
  credentialRef: z.string().trim().min(1).max(500).optional(),
  anthropicVersion: z.string().trim().max(50).nullable().default(null),
  headers: z.record(z.string(), z.string()).default({}),
  queryParams: z.record(z.string(), z.string()).default({}),
  requestStartTimeoutMs: z
    .number()
    .int()
    .positive()
    .max(600_000)
    .nullable()
    .default(null),
  streamIdleTimeoutMs: z
    .number()
    .int()
    .positive()
    .max(1_800_000)
    .nullable()
    .default(null),
  enabled: z.boolean().default(true),
});
export type UpsertProviderRequest = z.infer<typeof UpsertProviderRequestSchema>;

export const UpdateProviderRequestSchema = UpsertProviderRequestSchema.extend({
  expectedUpdatedAt: z.string().min(1),
});
export type UpdateProviderRequest = z.infer<typeof UpdateProviderRequestSchema>;

/**
 * Provider shape returned by the API: identical to ProviderSchema, with
 * credentialRef already masked by the server (`env:NAME` refs are not secret
 * and are returned as-is; raw keys are masked).
 */
export const PublicProviderSchema = ProviderSchema;
export type PublicProviderDto = z.infer<typeof PublicProviderSchema>;

export const ModelTaskTypeSchema = z.enum([
  "writing",
  "planning",
  "review",
  "embedding",
  "rerank",
]);
export type ModelTaskType = z.infer<typeof ModelTaskTypeSchema>;

export const ModelMetadataSourceSchema = z.enum([
  "manual",
  "environment",
  "catalog",
  "migration",
]);
export type ModelMetadataSource = z.infer<typeof ModelMetadataSourceSchema>;

export const ModelConfigSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  taskType: ModelTaskTypeSchema,
  contextWindow: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
  /** Default sampling parameters (temperature/top_p etc). */
  sampling: z.record(z.string(), z.unknown()),
  /** Capability flags (streaming/structuredOutput/tools/reasoning). */
  capabilities: z.record(z.string(), z.boolean()),
  /** Provenance of the physical limit declaration. */
  metadataSource: ModelMetadataSourceSchema,
  /** When the declared physical limits were last confirmed. */
  metadataVerifiedAt: z.string().nullable(),
  /** Advisory only; stale metadata is never silently replaced. */
  metadataStale: z.boolean(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ModelConfigDto = z.infer<typeof ModelConfigSchema>;

export const UpsertModelRequestSchema = z.object({
  providerId: z.string().trim().min(1).max(300),
  modelId: z.string().trim().min(1).max(200),
  taskType: ModelTaskTypeSchema.default("writing"),
  contextWindow: z
    .number()
    .int()
    .positive()
    .max(10_000_000)
    .nullable()
    .default(null),
  maxOutputTokens: z
    .number()
    .int()
    .positive()
    .max(1_000_000)
    .nullable()
    .default(null),
  sampling: z.record(z.string(), z.unknown()).default({}),
  capabilities: z.record(z.string(), z.boolean()).default({}),
  enabled: z.boolean().default(true),
});
export type UpsertModelRequest = z.infer<typeof UpsertModelRequestSchema>;

export const UpdateModelRequestSchema = UpsertModelRequestSchema.extend({
  expectedUpdatedAt: z.string().min(1),
});
export type UpdateModelRequest = z.infer<typeof UpdateModelRequestSchema>;

export const AssignmentRoleSchema = ModelTaskTypeSchema;
export type AssignmentRole = z.infer<typeof AssignmentRoleSchema>;

export const ModelAssignmentSchema = z.object({
  role: AssignmentRoleSchema,
  modelId: z.string().min(1),
  updatedAt: z.string(),
});
export type ModelAssignmentDto = z.infer<typeof ModelAssignmentSchema>;

export const SetAssignmentRequestSchema = z.object({
  modelId: z.string().trim().min(1).max(300),
});
