import { describe, expect, it } from "vitest";

import {
  deriveReviewResult,
  REVIEW_CONTRACT,
  ReviewResultSchema,
} from "../src/schemas.js";

const scores = {
  continuity: 90,
  pacing: 90,
  character: 90,
  prose: 90,
  goal: 90,
};

describe("derived semantic review verdict", () => {
  it("rejects model verdicts and normalizes minor author flags", () => {
    const withModelVerdict = ReviewResultSchema.safeParse({
      summary: "有一处轻微文句问题。",
      scores,
      issues: [
        {
          category: "prose",
          severity: "minor",
          message: "可以更凝练",
          evidenceParagraphs: [1],
          suggestedDirection: null,
          requiresAuthorDecision: true,
        },
      ],
      verdict: "block",
    });
    expect(withModelVerdict.success).toBe(false);
    const parsed = ReviewResultSchema.parse({
      summary: "有一处轻微文句问题。",
      scores,
      issues: [
        {
          category: "prose",
          severity: "minor",
          message: "可以更凝练",
          evidenceParagraphs: [1],
          suggestedDirection: null,
          requiresAuthorDecision: true,
        },
      ],
    });
    expect(deriveReviewResult(parsed)).toMatchObject({
      verdict: "pass",
      issues: [{ requiresAuthorDecision: false }],
    });
  });

  it("derives revise for unresolved major issues and block only for author decisions", () => {
    const major = ReviewResultSchema.parse({
      summary: "因果链需要修订。",
      scores,
      issues: [
        {
          category: "causality",
          severity: "major",
          message: "动机缺少页面证据",
          evidenceParagraphs: [1],
          suggestedDirection: "补充动机",
          requiresAuthorDecision: false,
        },
      ],
    });
    expect(deriveReviewResult(major).verdict).toBe("revise");
    expect(
      deriveReviewResult({
        ...major,
        issues: [{ ...major.issues[0], requiresAuthorDecision: true }],
      }).verdict,
    ).toBe("block");
  });

  it("requires chapter-goal failures to be major or critical", () => {
    const parsed = ReviewResultSchema.safeParse({
      summary: "目标没有完成。",
      scores: { ...scores, goal: 30 },
      issues: [
        {
          category: "goal",
          severity: "minor",
          message: "目标只完成一半",
          evidenceParagraphs: [1],
          suggestedDirection: "补足结果",
          requiresAuthorDecision: false,
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("removes verdict from the model contract", () => {
    expect(REVIEW_CONTRACT.schema.required).not.toContain("verdict");
    expect(REVIEW_CONTRACT.schema.properties).not.toHaveProperty("verdict");
  });
});
