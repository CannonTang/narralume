import type { Migration } from "../database.js";

export const migration019 = {
  version: 19,
  name: "019-physical-call-reservations",
  sql: `
    -- Physical requests are charged before dispatch. This step-scoped row
    -- lets the Harness reconcile the worker's aggregate usage without
    -- charging those already-reserved requests a second time.
    CREATE TABLE physical_call_reservations (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL REFERENCES run_steps(id) ON DELETE CASCADE,
      reserved_calls INTEGER NOT NULL DEFAULT 0 CHECK (reserved_calls >= 0),
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, step_id)
    ) STRICT;
  `,
} as const satisfies Migration;
