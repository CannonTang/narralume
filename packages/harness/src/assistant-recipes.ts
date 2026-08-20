import type { RunStepKind } from "@narrative-lantern/domain";

import type { RunStepSeed } from "./recipe.js";

export interface AssistantRecipe {
  name: "assistant-turn";
  version: number;
  steps: readonly RunStepSeed[];
}

export function buildAssistantTurnRecipe(runId: string): AssistantRecipe {
  const definitions: readonly [string, RunStepKind, number][] = [
    ["context", "assistant.context", 1],
    ["respond", "assistant.respond", 5],
    ["stage", "assistant.stage", 1],
  ];
  return {
    name: "assistant-turn",
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
