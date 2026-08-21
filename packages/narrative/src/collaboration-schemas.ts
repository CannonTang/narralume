import type { JsonSchemaContract, StructuredValidator } from "@narralume/llm";
import { z } from "zod";

import { GroundedParagraphEvidenceSchema } from "./schemas.js";

const EvidenceParagraphsSchema = z
  .array(z.number().int().positive())
  .min(1)
  .max(5)
  .refine((ordinals) => new Set(ordinals).size === ordinals.length, {
    message: "段号不得重复",
  });

export const CoCreateResponseSchema = z.object({
  speakerPersonaId: z.string().min(1),
  content: z.string().min(1).max(100_000),
  intent: z.string().min(1),
  emotionalShift: z.string().min(1),
  suggestedCanonFacts: z
    .array(
      z.object({
        subjectName: z.string().min(1),
        predicate: z.string().min(1),
        value: z.string().min(1),
        rationale: z.string().min(1),
      }),
    )
    .max(12),
});
export type CoCreateResponse = z.infer<typeof CoCreateResponseSchema>;

export const AdoptionResultSchema = z.object({
  sceneTitle: z.string().min(1).max(300),
  sceneContent: z.string().min(1).max(500_000),
  summary: z.string().min(1).max(30_000),
  canonCandidates: z
    .array(
      z.object({
        subjectName: z.string().min(1),
        predicate: z.string().min(1),
        value: z.string().min(1),
        evidenceParagraphs: EvidenceParagraphsSchema,
        rationale: z.string().min(1),
      }),
    )
    .max(50),
});
export type AdoptionResult = z.infer<typeof AdoptionResultSchema>;

export const GroundedAdoptionResultSchema = AdoptionResultSchema.extend({
  canonCandidates: z.array(
    AdoptionResultSchema.shape.canonCandidates.element.extend({
      evidence: z.array(GroundedParagraphEvidenceSchema).min(1).max(5),
    }),
  ),
});
export type GroundedAdoptionResult = z.infer<
  typeof GroundedAdoptionResultSchema
>;

export const SelectionEditResultSchema = z.object({
  replacementText: z.string().min(1).max(500_000),
  rationale: z.string().min(1).max(20_000),
  risk: z.enum(["low", "medium", "high"]),
});
export type SelectionEditResult = z.infer<typeof SelectionEditResultSchema>;

export const COCREATE_RESPONSE_CONTRACT: JsonSchemaContract = {
  name: "cocreate_response",
  description:
    "A single in-character or narrator continuation for a story room.",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "speakerPersonaId",
      "content",
      "intent",
      "emotionalShift",
      "suggestedCanonFacts",
    ],
    properties: {
      speakerPersonaId: { type: "string", minLength: 1 },
      content: { type: "string", minLength: 1 },
      intent: { type: "string", minLength: 1 },
      emotionalShift: { type: "string", minLength: 1 },
      suggestedCanonFacts: {
        type: "array",
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["subjectName", "predicate", "value", "rationale"],
          properties: {
            subjectName: { type: "string", minLength: 1 },
            predicate: { type: "string", minLength: 1 },
            value: { type: "string", minLength: 1 },
            rationale: { type: "string", minLength: 1 },
          },
        },
      },
    },
  },
};

export const ADOPTION_RESULT_CONTRACT: JsonSchemaContract = {
  name: "scene_adoption",
  description:
    "A prose scene and candidate canon changes derived from selected room turns.",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["sceneTitle", "sceneContent", "summary", "canonCandidates"],
    properties: {
      sceneTitle: { type: "string", minLength: 1 },
      sceneContent: { type: "string", minLength: 1 },
      summary: { type: "string", minLength: 1 },
      canonCandidates: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "subjectName",
            "predicate",
            "value",
            "evidenceParagraphs",
            "rationale",
          ],
          properties: {
            subjectName: { type: "string", minLength: 1 },
            predicate: { type: "string", minLength: 1 },
            value: { type: "string", minLength: 1 },
            evidenceParagraphs: {
              type: "array",
              minItems: 1,
              maxItems: 5,
              uniqueItems: true,
              items: { type: "integer", minimum: 1 },
            },
            rationale: { type: "string", minLength: 1 },
          },
        },
      },
    },
  },
};

export const SELECTION_EDIT_CONTRACT: JsonSchemaContract = {
  name: "selection_edit",
  description: "A bounded replacement for an exact manuscript selection.",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["replacementText", "rationale", "risk"],
    properties: {
      replacementText: { type: "string", minLength: 1 },
      rationale: { type: "string", minLength: 1 },
      risk: { type: "string", enum: ["low", "medium", "high"] },
    },
  },
};

export function collaborationValidator<T>(
  schema: z.ZodType<T>,
  semantic?: (value: T) => readonly string[],
): StructuredValidator<T> {
  return (value) => {
    const parsed = schema.safeParse(value);
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
