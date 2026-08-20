export const migration010 = {
  version: 10,
  name: "persistent-run-streams",
  sql: `
    CREATE TABLE run_stream_attempts (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL REFERENCES run_steps(id) ON DELETE CASCADE,
      attempt INTEGER NOT NULL CHECK (attempt > 0),
      content TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('streaming','completed','interrupted')),
      updated_at TEXT NOT NULL,
      PRIMARY KEY(step_id, attempt)
    ) STRICT;

    CREATE INDEX run_stream_attempts_run_idx
      ON run_stream_attempts(run_id, step_id, attempt);
  `,
} as const;
