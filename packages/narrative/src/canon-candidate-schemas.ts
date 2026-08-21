import {
  CanonCandidateItemSchema,
  CanonSpreadSchema,
} from "@narralume/contracts";
import type { JsonSchemaContract, StructuredValidator } from "@narralume/llm";
import { z } from "zod";

export const CanonCandidateModelItemSchema = z
  .object({
    operation: z.enum(["create", "update", "withdraw"]),
    targetId: z.string().trim().min(1).max(300).nullable(),
    title: z.string().trim().min(1).max(500),
    rationale: z.string().trim().min(1).max(10_000),
    impact: z.array(z.string().trim().min(1).max(2_000)).max(12),
    afterJson: z.string().max(100_000).nullable(),
  })
  .strict();

export const CanonCandidateModelResultSchema = z
  .object({
    summary: z.string().trim().min(1).max(10_000),
    items: z.array(CanonCandidateModelItemSchema).min(1).max(20),
  })
  .strict();
export type CanonCandidateModelResult = z.infer<
  typeof CanonCandidateModelResultSchema
>;

export const CANON_CANDIDATE_MODEL_CONTRACT: JsonSchemaContract = {
  name: "canon_spread_candidate",
  description:
    "A small set of reviewable changes for one story-bible spread. afterJson contains one JSON object matching the requested spread.",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "items"],
    properties: {
      summary: { type: "string", minLength: 1 },
      items: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "operation",
            "targetId",
            "title",
            "rationale",
            "impact",
            "afterJson",
          ],
          properties: {
            operation: {
              type: "string",
              enum: ["create", "update", "withdraw"],
            },
            targetId: { anyOf: [{ type: "string" }, { type: "null" }] },
            title: { type: "string", minLength: 1 },
            rationale: { type: "string", minLength: 1 },
            impact: {
              type: "array",
              maxItems: 12,
              items: { type: "string", minLength: 1 },
            },
            afterJson: {
              anyOf: [{ type: "string" }, { type: "null" }],
            },
          },
        },
      },
    },
  },
};

export function canonCandidateModelValidator(
  semantic?: (value: CanonCandidateModelResult) => readonly string[],
): StructuredValidator<CanonCandidateModelResult> {
  return (value) => {
    const parsed = CanonCandidateModelResultSchema.safeParse(value);
    if (!parsed.success) {
      return {
        success: false,
        issues: parsed.error.issues.map(
          (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
        ),
      };
    }
    const issues = semantic?.(parsed.data) ?? [];
    return issues.length > 0
      ? { success: false, issues: [...issues] }
      : { success: true, data: parsed.data };
  };
}

export const PersistedCanonCandidateItemSchema = CanonCandidateItemSchema.omit({
  decision: true,
});

export const CanonCandidateChangesSchema = z
  .object({
    kind: z.literal("canon_spread_revision"),
    spread: CanonSpreadSchema,
    instruction: z.string(),
    summary: z.string(),
    baseFingerprint: z.string(),
    items: z.array(PersistedCanonCandidateItemSchema),
  })
  .strict();
export type CanonCandidateChanges = z.infer<typeof CanonCandidateChangesSchema>;
