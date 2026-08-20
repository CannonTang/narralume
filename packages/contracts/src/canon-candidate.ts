import { z } from "zod";

const IdSchema = z.string().trim().min(1).max(300);
const TimestampSchema = z.string().min(1);
const JsonObjectSchema = z.record(z.string(), z.unknown());

export const CanonSpreadSchema = z.enum([
  "intent",
  "outline",
  "entities",
  "facts",
  "relations",
  "timeline",
  "foreshadows",
]);
export type CanonSpread = z.infer<typeof CanonSpreadSchema>;

export const CanonCandidateOperationSchema = z.enum([
  "create",
  "update",
  "withdraw",
]);

export const CanonCandidateDiffFieldSchema = z.object({
  field: z.string(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});

export const CanonCandidateDecisionSchema = z.object({
  action: z.enum(["apply", "reject"]),
  result: JsonObjectSchema.nullable(),
  decidedAt: TimestampSchema,
});

export const CanonCandidateItemSchema = z.object({
  id: IdSchema,
  operation: CanonCandidateOperationSchema,
  targetId: IdSchema.nullable(),
  title: z.string(),
  rationale: z.string(),
  impact: z.array(z.string()),
  before: JsonObjectSchema.nullable(),
  after: JsonObjectSchema.nullable(),
  diff: z.array(CanonCandidateDiffFieldSchema),
  requiresLockedConfirmation: z.boolean(),
  decision: CanonCandidateDecisionSchema.nullable(),
});

export const CanonCandidateSetSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  runId: IdSchema,
  stepId: IdSchema,
  spread: CanonSpreadSchema,
  instruction: z.string(),
  summary: z.string(),
  baseFingerprint: z.string(),
  currentFingerprint: z.string(),
  stale: z.boolean(),
  status: z.enum(["candidate", "partially_applied", "applied", "rejected"]),
  items: z.array(CanonCandidateItemSchema),
  createdAt: TimestampSchema,
  decidedAt: TimestampSchema.nullable(),
});
export type CanonCandidateSetDto = z.infer<typeof CanonCandidateSetSchema>;
export type CanonCandidateItemDto = z.infer<typeof CanonCandidateItemSchema>;

export const CreateCanonCandidateRequestSchema = z.object({
  requestId: z.string().uuid(),
  instruction: z.string().trim().min(1).max(100_000),
});
export type CreateCanonCandidateRequest = z.infer<
  typeof CreateCanonCandidateRequestSchema
>;

export const CanonCandidateRunAcceptedSchema = z.object({
  runId: IdSchema,
  idempotentReplay: z.boolean(),
});

export const DecideCanonCandidateItemRequestSchema = z.object({
  action: z.enum(["apply", "reject"]),
  confirmLocked: z.boolean().default(false),
});

export const DecideCanonCandidateItemResponseSchema = z.object({
  candidateSet: CanonCandidateSetSchema,
  item: CanonCandidateItemSchema,
});
