import type { RunStepSeed } from "./recipe.js";

export interface DeliveryRecipe {
  name: "import-analysis";
  version: 1;
  steps: readonly RunStepSeed[];
}

export function buildImportAnalysisRecipe(runId: string): DeliveryRecipe {
  return {
    name: "import-analysis",
    version: 1,
    steps: [
      {
        id: `${runId}:import.analyze`,
        ordinal: 0,
        kind: "import.analyze",
        cycle: 0,
        idempotencyKey: `${runId}/import.analyze`,
        maxAttempts: 5,
      },
      {
        id: `${runId}:import.stage`,
        ordinal: 1,
        kind: "import.stage",
        cycle: 0,
        idempotencyKey: `${runId}/import.stage`,
        maxAttempts: 1,
      },
    ],
  };
}
