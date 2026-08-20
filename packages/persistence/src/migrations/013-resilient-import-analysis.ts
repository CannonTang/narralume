export const migration013 = {
  version: 13,
  name: "resilient-import-analysis",
  sql: `
    CREATE TABLE import_analysis_artifacts (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      stage TEXT NOT NULL CHECK (stage IN ('chunk','synthesis')),
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      input_digest TEXT NOT NULL,
      output_json TEXT NOT NULL CHECK (json_valid(output_json)),
      output_digest TEXT NOT NULL,
      usage_json TEXT NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0,"calls":0,"costUsd":0,"wallTimeMs":0}' CHECK (json_valid(usage_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(batch_id, stage, ordinal)
    ) STRICT;

    CREATE INDEX import_analysis_artifacts_batch_idx
      ON import_analysis_artifacts(batch_id, stage, ordinal);

    CREATE TABLE review_lessons (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      pattern TEXT NOT NULL,
      guidance TEXT NOT NULL,
      confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      occurrences INTEGER NOT NULL CHECK (occurrences > 0),
      status TEXT NOT NULL CHECK (status IN ('active','retired')),
      last_issue_id TEXT REFERENCES review_issues(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, category, pattern)
    ) STRICT;

    CREATE INDEX review_lessons_project_idx
      ON review_lessons(project_id, status, confidence DESC, updated_at DESC);
  `,
} as const;
