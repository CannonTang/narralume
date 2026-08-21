import {
  AUTOMATION_DEFAULTS,
  AUTOMATION_LIMITS,
  CreateAutopilotSessionRequestSchema,
  GenerateFoundationRequestSchema,
} from "@narralume/contracts";
import { describe, expect, it } from "vitest";

describe("automation numeric contracts", () => {
  it("uses one foundation planning default across entry points", () => {
    const parsed = GenerateFoundationRequestSchema.parse({
      requestId: "foundation-defaults",
      braindump: "写一部长篇小说。",
    });

    expect(parsed.preferences).toMatchObject(AUTOMATION_DEFAULTS);
  });

  it("does not impose a product limit on words per chapter", () => {
    expect(
      GenerateFoundationRequestSchema.safeParse({
        requestId: "foundation-large-chapter",
        braindump: "写一部长篇小说。",
        preferences: { wordsPerChapter: 100_000 },
      }).success,
    ).toBe(true);
  });

  it("keeps resource-expanding chapter and planning limits", () => {
    expect(
      CreateAutopilotSessionRequestSchema.safeParse({
        requestId: "too-many-chapters",
        targetChapters: AUTOMATION_LIMITS.targetChapters + 1,
      }).success,
    ).toBe(false);
    expect(
      CreateAutopilotSessionRequestSchema.safeParse({
        requestId: "planning-window-too-large",
        windowSize: AUTOMATION_LIMITS.planningWindow + 1,
      }).success,
    ).toBe(false);
  });
});
