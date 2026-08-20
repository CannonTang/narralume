import {
  compileChapterRecipeTemplate,
  compileCoCreateRecipeTemplate,
  RecipeTemplateError,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

describe("recipe template compiler", () => {
  it("expands revision cycles while preserving gates and configured attempts", () => {
    const recipe = compileChapterRecipeTemplate(
      "run-1",
      JSON.stringify({
        maxRevisionCycles: 1,
        steps: [
          { kind: "context.compile", maxAttempts: 5 },
          "scene.plan",
          "draft.generate",
          "deterministic.check",
          "semantic.review",
          "revision.generate?",
          "chapter.settle",
          "chapter.commit",
        ],
      }),
      4,
      7,
    );
    expect(recipe.version).toBe(8);
    expect(recipe.maxRevisionCycles).toBe(1);
    expect(recipe.steps[0]).toMatchObject({
      kind: "context.compile",
      maxAttempts: 5,
    });
    expect(recipe.steps.map((step) => step.kind)).toEqual([
      "context.compile",
      "scene.plan",
      "draft.generate",
      "deterministic.check",
      "semantic.review",
      "revision.generate",
      "deterministic.check",
      "semantic.review",
      "chapter.settle",
      "chapter.commit",
    ]);
  });

  it("rejects recipes that move commit ahead of settlement", () => {
    expect(() =>
      compileChapterRecipeTemplate(
        "run-2",
        JSON.stringify({
          steps: [
            "context.compile",
            "scene.plan",
            "draft.generate",
            "deterministic.check",
            "semantic.review",
            "revision.generate?",
            "chapter.commit",
            "chapter.settle",
          ],
        }),
        1,
        0,
      ),
    ).toThrowError(RecipeTemplateError);
  });

  it("compiles the co-create template into executable steps", () => {
    const recipe = compileCoCreateRecipeTemplate(
      "run-3",
      JSON.stringify({
        steps: [
          "cocreate.context",
          { kind: "cocreate.respond", maxAttempts: 6 },
          "cocreate.stage",
        ],
      }),
      2,
    );
    expect(recipe.steps[1]).toMatchObject({
      kind: "cocreate.respond",
      maxAttempts: 6,
    });
  });
});
