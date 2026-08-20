import type {
  JsonSchemaContract,
  StructuredValidator,
} from "@narrative-lantern/llm";
import { z } from "zod";

const IdSchema = z.string().trim().min(1).max(300);

export const AssistantToolCallSchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("story.inspect"),
    arguments: z.object({}).strict(),
  }),
  z.object({
    name: z.literal("review.inspect"),
    arguments: z.object({}).strict(),
  }),
  z.object({
    name: z.literal("foundation.start"),
    arguments: z
      .object({ braindump: z.string().trim().min(1).max(100_000) })
      .strict(),
  }),
  z.object({
    name: z.literal("chapter.start"),
    arguments: z.object({ targetOutlineNodeId: IdSchema }).strict(),
  }),
  z.object({
    name: z.literal("autopilot.start"),
    arguments: z
      .object({
        targetChapters: z.number().int().min(1).max(50),
        approvalMode: z.enum(["continuous", "per_chapter"]),
      })
      .strict(),
  }),
  z.object({
    name: z.literal("outline.plan.start"),
    arguments: z
      .object({ targetChapters: z.number().int().min(1).max(20) })
      .strict(),
  }),
  z.object({
    name: z.literal("canon.candidate.start"),
    arguments: z
      .object({
        spread: z.enum([
          "intent",
          "outline",
          "entities",
          "facts",
          "relations",
          "timeline",
          "foreshadows",
        ]),
        instruction: z.string().trim().min(1).max(20_000),
      })
      .strict(),
  }),
  z.object({
    name: z.literal("selection.edit.start"),
    arguments: z
      .object({
        documentId: IdSchema,
        selectionStart: z.number().int().nonnegative(),
        selectionEnd: z.number().int().nonnegative(),
        instruction: z.string().trim().min(1).max(20_000),
      })
      .strict(),
  }),
  z.object({
    name: z.literal("long_goal.start"),
    arguments: z
      .object({
        targetChapters: z.number().int().min(1).max(50),
        braindump: z
          .string()
          .trim()
          .min(1)
          .max(100_000)
          .nullable()
          .default(null),
      })
      .strict(),
  }),
  z.object({
    name: z.literal("task.control"),
    arguments: z
      .object({
        sourceType: z.enum(["run", "autopilot"]),
        sourceId: IdSchema,
        action: z.enum([
          "pause",
          "resume",
          "cancel",
          "retry-current",
          "skip-chapter",
          "replan",
          "stop",
        ]),
      })
      .strict(),
  }),
]);
export type AssistantToolCall = z.infer<typeof AssistantToolCallSchema>;

export const AssistantReplySchema = z
  .object({
    reply: z.string().trim().min(1).max(100_000),
    toolCall: AssistantToolCallSchema.nullable(),
  })
  .strict();
export type AssistantReply = z.infer<typeof AssistantReplySchema>;

export const AssistantReplyArtifactSchema = AssistantReplySchema.extend({
  generation: z
    .object({
      mode: z.enum(["native", "json-mode", "prompt", "repair"]),
      attempts: z.number().int().min(1),
    })
    .strict(),
}).strict();

const CANON_SPREADS = [
  "intent",
  "outline",
  "entities",
  "facts",
  "relations",
  "timeline",
  "foreshadows",
] as const;

function toolCallVariant(
  name: string,
  argumentsSchema: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["name", "arguments"],
    properties: {
      name: { type: "string", enum: [name] },
      arguments: argumentsSchema,
    },
  };
}

function emptyArguments(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: [],
    properties: {},
  };
}

const ID_STRING = { type: "string", minLength: 1, maxLength: 300 } as const;

export const ASSISTANT_REPLY_CONTRACT: JsonSchemaContract = {
  name: "project_assistant_reply",
  description:
    "A grounded project-assistant reply with at most one call from the server allowlist.",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["reply", "toolCall"],
    properties: {
      reply: { type: "string", minLength: 1, maxLength: 100_000 },
      toolCall: {
        anyOf: [
          { type: "null" },
          toolCallVariant("story.inspect", emptyArguments()),
          toolCallVariant("review.inspect", emptyArguments()),
          toolCallVariant("foundation.start", {
            type: "object",
            additionalProperties: false,
            required: ["braindump"],
            properties: {
              braindump: {
                type: "string",
                minLength: 1,
                maxLength: 100_000,
              },
            },
          }),
          toolCallVariant("chapter.start", {
            type: "object",
            additionalProperties: false,
            required: ["targetOutlineNodeId"],
            properties: { targetOutlineNodeId: ID_STRING },
          }),
          toolCallVariant("autopilot.start", {
            type: "object",
            additionalProperties: false,
            required: ["targetChapters", "approvalMode"],
            properties: {
              targetChapters: { type: "integer", minimum: 1, maximum: 50 },
              approvalMode: {
                type: "string",
                enum: ["continuous", "per_chapter"],
              },
            },
          }),
          toolCallVariant("outline.plan.start", {
            type: "object",
            additionalProperties: false,
            required: ["targetChapters"],
            properties: {
              targetChapters: { type: "integer", minimum: 1, maximum: 20 },
            },
          }),
          toolCallVariant("canon.candidate.start", {
            type: "object",
            additionalProperties: false,
            required: ["spread", "instruction"],
            properties: {
              spread: { type: "string", enum: [...CANON_SPREADS] },
              instruction: { type: "string", minLength: 1, maxLength: 20_000 },
            },
          }),
          toolCallVariant("selection.edit.start", {
            type: "object",
            additionalProperties: false,
            required: [
              "documentId",
              "selectionStart",
              "selectionEnd",
              "instruction",
            ],
            properties: {
              documentId: ID_STRING,
              selectionStart: { type: "integer", minimum: 0 },
              selectionEnd: { type: "integer", minimum: 0 },
              instruction: { type: "string", minLength: 1, maxLength: 20_000 },
            },
          }),
          toolCallVariant("long_goal.start", {
            type: "object",
            additionalProperties: false,
            required: ["targetChapters", "braindump"],
            properties: {
              targetChapters: { type: "integer", minimum: 1, maximum: 50 },
              braindump: {
                anyOf: [
                  { type: "string", minLength: 1, maxLength: 100_000 },
                  { type: "null" },
                ],
              },
            },
          }),
          toolCallVariant("task.control", {
            type: "object",
            additionalProperties: false,
            required: ["sourceType", "sourceId", "action"],
            properties: {
              sourceType: { type: "string", enum: ["run", "autopilot"] },
              sourceId: ID_STRING,
              action: {
                type: "string",
                enum: [
                  "pause",
                  "resume",
                  "cancel",
                  "retry-current",
                  "skip-chapter",
                  "replan",
                  "stop",
                ],
              },
            },
          }),
        ],
      },
    },
  },
};

export function assistantReplyValidator(
  semantic?: (value: AssistantReply) => readonly string[],
): StructuredValidator<AssistantReply> {
  return (value) => {
    const parsed = AssistantReplySchema.safeParse(value);
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
