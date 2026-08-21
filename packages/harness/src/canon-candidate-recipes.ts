import type { RunStepKind } from "@narralume/domain";

import type { RunStepSeed } from "./recipe.js";

export interface CanonCandidateRecipe {
  name: "canon-spread-candidate";
  version: number;
  steps: readonly RunStepSeed[];
}

export function buildCanonCandidateRecipe(runId: string): CanonCandidateRecipe {
  const definitions: readonly [string, RunStepKind, number][] = [
    ["context", "canon.context", 1],
    ["candidate", "canon.candidate", 5],
    ["stage", "canon.stage", 1],
  ];
  return {
    name: "canon-spread-candidate",
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
