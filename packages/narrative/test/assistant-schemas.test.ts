import { describe, expect, it } from "vitest";

import {
  ASSISTANT_REPLY_CONTRACT,
  AssistantReplyArtifactSchema,
  AssistantReplySchema,
  assistantReplyValidator,
} from "../src/assistant-schemas.js";

describe("assistant reply contract", () => {
  it("rejects tools and arguments outside the code-owned allowlist", () => {
    expect(
      AssistantReplySchema.safeParse({
        reply: "我已经直接修改了正典。",
        toolCall: {
          name: "canon.write",
          arguments: { table: "canon_facts" },
        },
      }).success,
    ).toBe(false);
    expect(
      AssistantReplySchema.safeParse({
        reply: "确认后开始写作。",
        toolCall: {
          name: "chapter.start",
          arguments: {
            targetOutlineNodeId: "chapter-1",
            bypassConfirmation: true,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("applies server-grounded semantic checks after structural validation", () => {
    const validate = assistantReplyValidator((reply) =>
      reply.toolCall?.name === "chapter.start" &&
      reply.toolCall.arguments.targetOutlineNodeId !== "known-chapter"
        ? ["target is not a current chapter"]
        : [],
    );
    expect(
      validate({
        reply: "确认后开始写作。",
        toolCall: {
          name: "chapter.start",
          arguments: { targetOutlineNodeId: "invented-chapter" },
        },
      }),
    ).toMatchObject({ success: false });
    expect(
      validate({
        reply: "确认后开始写作。",
        toolCall: {
          name: "chapter.start",
          arguments: { targetOutlineNodeId: "known-chapter" },
        },
      }),
    ).toMatchObject({ success: true });
  });

  it("keeps every structured-output tool branch strict and aligned", () => {
    const toolCall = ASSISTANT_REPLY_CONTRACT.schema.properties?.toolCall as {
      anyOf: Array<Record<string, unknown>>;
    };
    expect(toolCall.anyOf).toHaveLength(11);
    const branches = toolCall.anyOf.slice(1) as Array<{
      additionalProperties: boolean;
      required: string[];
      properties: {
        name: { enum: string[] };
        arguments: {
          additionalProperties: boolean;
          required: string[];
          properties: Record<string, unknown>;
        };
      };
    }>;
    expect(branches.map((branch) => branch.properties.name.enum[0])).toEqual([
      "story.inspect",
      "review.inspect",
      "foundation.start",
      "chapter.start",
      "autopilot.start",
      "outline.plan.start",
      "canon.candidate.start",
      "selection.edit.start",
      "long_goal.start",
      "task.control",
    ]);
    expect(
      branches.map((branch) => ({
        toolStrict: branch.additionalProperties,
        argumentsStrict: branch.properties.arguments.additionalProperties,
        required: branch.properties.arguments.required,
      })),
    ).toEqual([
      { toolStrict: false, argumentsStrict: false, required: [] },
      { toolStrict: false, argumentsStrict: false, required: [] },
      { toolStrict: false, argumentsStrict: false, required: ["braindump"] },
      {
        toolStrict: false,
        argumentsStrict: false,
        required: ["targetOutlineNodeId"],
      },
      {
        toolStrict: false,
        argumentsStrict: false,
        required: ["targetChapters", "approvalMode"],
      },
      {
        toolStrict: false,
        argumentsStrict: false,
        required: ["targetChapters"],
      },
      {
        toolStrict: false,
        argumentsStrict: false,
        required: ["spread", "instruction"],
      },
      {
        toolStrict: false,
        argumentsStrict: false,
        required: [
          "documentId",
          "selectionStart",
          "selectionEnd",
          "instruction",
        ],
      },
      {
        toolStrict: false,
        argumentsStrict: false,
        required: ["targetChapters", "braindump"],
      },
      {
        toolStrict: false,
        argumentsStrict: false,
        required: ["sourceType", "sourceId", "action"],
      },
    ]);
  });

  it("rejects unknown reply fields", () => {
    expect(
      AssistantReplySchema.safeParse({
        reply: "先检查当前故事状态。",
        toolCall: null,
        legacyAction: "inspect",
      }).success,
    ).toBe(false);
  });

  it("parses the persisted reply artifact separately from model output", () => {
    expect(
      AssistantReplyArtifactSchema.parse({
        reply: "先检查当前故事状态。",
        toolCall: null,
        generation: { mode: "native", attempts: 1 },
      }),
    ).toMatchObject({ generation: { mode: "native", attempts: 1 } });
  });

  it("accepts repair as a final structured mode in the persisted artifact", () => {
    // 修复通道成功时 result.mode === "repair"；stage 步骤解析该工件不得拒绝。
    expect(
      AssistantReplyArtifactSchema.safeParse({
        reply: "先检查当前故事状态。",
        toolCall: null,
        generation: { mode: "repair", attempts: 3 },
      }).success,
    ).toBe(true);
  });
});
