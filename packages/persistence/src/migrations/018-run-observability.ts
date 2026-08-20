import type { Migration } from "../database.js";

export const migration018 = {
  version: 18,
  name: "018-run-observability",
  sql: `
    -- llm_calls.details_json: free-form success-side receipt details. The
    -- structured path records repairAttempts here (physical repair calls are
    -- not individually ledgered — one llm_calls row per logical call), and
    -- text/structured record the transport-measured totalDurationMs.
    ALTER TABLE llm_calls
      ADD COLUMN details_json TEXT
      CHECK (details_json IS NULL OR json_valid(details_json));

    -- context_receipts.degradations_json: capability degradations (e.g.
    -- embedding unavailable, degraded to FTS/entity ranking) noted on the
    -- compiled context receipt.
    ALTER TABLE context_receipts
      ADD COLUMN degradations_json TEXT
      CHECK (degradations_json IS NULL OR json_valid(degradations_json));
  `,
} as const satisfies Migration;
