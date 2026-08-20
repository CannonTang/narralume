import type { RunStepKind } from "@narrative-lantern/domain";

import type { RunStepSeed } from "./recipe.js";

export interface CollaborationRecipe {
  name: "cocreate-reply" | "scene-adoption" | "selection-edit";
  version: number;
  steps: readonly RunStepSeed[];
}

export function buildCoCreateReplyRecipe(runId: string): CollaborationRecipe {
  return recipe(runId, "cocreate-reply", [
    ["context", "cocreate.context", 2],
    ["respond", "cocreate.respond", 5],
    ["stage", "cocreate.stage", 1],
  ]);
}

export function buildSceneAdoptionRecipe(runId: string): CollaborationRecipe {
  return recipe(runId, "scene-adoption", [
    ["prepare", "adoption.prepare", 1],
    ["settle", "adoption.settle", 5],
    ["commit", "adoption.commit", 1],
  ]);
}

export function buildSelectionEditRecipe(runId: string): CollaborationRecipe {
  return recipe(runId, "selection-edit", [
    ["transform", "edit.transform", 5],
    ["stage", "edit.stage", 1],
  ]);
}

function recipe(
  runId: string,
  name: CollaborationRecipe["name"],
  definitions: readonly [key: string, kind: RunStepKind, maxAttempts: number][],
): CollaborationRecipe {
  return {
    name,
    version: 1,
    steps: definitions.map(([key, kind, maxAttempts], ordinal) => ({
      id: `${runId}:${key}`,
      ordinal,
      kind,
      cycle: 0,
      idempotencyKey: `${runId}/${key}`,
      maxAttempts,
    })),
  };
}
