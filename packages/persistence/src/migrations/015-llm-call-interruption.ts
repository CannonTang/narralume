export const migration015 = {
  version: 15,
  name: "llm-call-interruption",
  // Rebuilds llm_calls to extend the status CHECK with 'interrupted'.
  // Runs with foreign_keys disabled (outside the migration transaction) so the
  // DROP TABLE does not fire ON DELETE SET NULL on tool_calls/run_budget_entries.
  foreignKeysOff: true,
  sql: `
    CREATE TABLE llm_calls_v15 (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      step_id TEXT REFERENCES run_steps(id) ON DELETE SET NULL,
      profile_id TEXT NOT NULL REFERENCES model_profiles(id),
      protocol TEXT NOT NULL,
      model TEXT NOT NULL,
      purpose TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('started','streaming','completed','failed','cancelled','interrupted')),
      response_id TEXT,
      finish_reason TEXT,
      usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
      error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
      ttft_ms INTEGER,
      duration_ms INTEGER,
      started_at TEXT NOT NULL,
      finished_at TEXT
    ) STRICT;

    INSERT INTO llm_calls_v15 SELECT * FROM llm_calls;
    DROP TABLE llm_calls;
    ALTER TABLE llm_calls_v15 RENAME TO llm_calls;

    CREATE INDEX llm_calls_run_idx ON llm_calls(run_id, started_at DESC);
  `,
} as const;
