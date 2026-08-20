import { describe, expect, it } from "vitest";

import {
  ModelExecutionPolicySchema,
  extractPolicyUnknownFields,
  resolveEffectivePolicy,
} from "../src/index.js";

describe("B1 execution policy", () => {
  it.each([
    ["fast", 64_000, 16_000, 16_000],
    ["standard", 128_000, 32_000, 24_000],
    ["deep", 256_000, 64_000, 32_000],
  ] as const)(
    "expands %s into calibrated context and output work ceilings",
    (qualityPreset, contextWindow, draft, structured) => {
      expect(
        resolveEffectivePolicy({ qualityPreset }).effectivePolicy,
      ).toMatchObject({
        qualityPreset,
        contextWindow,
        draftMaxOutputTokens: draft,
        planningMaxOutputTokens: structured,
        reviewMaxOutputTokens: structured,
        settlementMaxOutputTokens: structured,
      });
    },
  );

  it("lets explicit work ceilings override a preset", () => {
    expect(
      resolveEffectivePolicy({
        qualityPreset: "fast",
        contextWindow: 1_000_000,
        draftMaxOutputTokens: 80_000,
      }).effectivePolicy,
    ).toMatchObject({ contextWindow: 1_000_000, draftMaxOutputTokens: 80_000 });
  });

  it.each([
    "modelRoutingMode",
    "maxPhysicalCalls",
    "outputReserve",
    "embeddingModelId",
    "modelRequestTimeoutMs",
    "embeddingModel",
  ])("rejects removed legacy field %s", (field) => {
    const parsed = ModelExecutionPolicySchema.safeParse({ [field]: 1 });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(extractPolicyUnknownFields(parsed.error)).toEqual([field]);
  });

  it("preserves independent timeout scopes", () => {
    expect(
      resolveEffectivePolicy({
        requestStartTimeoutMs: 90_000,
        streamIdleTimeoutMs: 180_000,
        logicalCallDeadlineMs: 900_000,
        stepDeadlineMs: 1_200_000,
        runDeadlineMs: 3_600_000,
      }).effectivePolicy,
    ).toMatchObject({
      requestStartTimeoutMs: 90_000,
      streamIdleTimeoutMs: 180_000,
      logicalCallDeadlineMs: 900_000,
      stepDeadlineMs: 1_200_000,
      runDeadlineMs: 3_600_000,
    });
  });
});
