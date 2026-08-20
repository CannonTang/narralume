export const migration008 = {
  version: 8,
  name: "canon-fact-withdrawals",
  sql: `
    CREATE TABLE canon_fact_withdrawals (
      fact_id TEXT PRIMARY KEY REFERENCES canon_facts(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      withdrawn_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX canon_fact_withdrawals_project_idx
      ON canon_fact_withdrawals(project_id, withdrawn_at DESC);
  `,
} as const;
