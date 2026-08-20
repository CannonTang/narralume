export const migration003 = {
  version: 3,
  name: "recoverable-harness",
  sql: `
    ALTER TABLE runs ADD COLUMN recipe_version INTEGER NOT NULL DEFAULT 1 CHECK (recipe_version > 0);
    ALTER TABLE runs ADD COLUMN profile_id TEXT REFERENCES model_profiles(id) ON DELETE SET NULL;
    ALTER TABLE runs ADD COLUMN target_outline_node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL;
    ALTER TABLE runs ADD COLUMN budget_limit_json TEXT NOT NULL DEFAULT '{"maxInputTokens":500000,"maxOutputTokens":200000,"maxCalls":200,"maxCostUsd":null,"maxWallTimeMs":7200000}' CHECK (json_valid(budget_limit_json));
    ALTER TABLE runs ADD COLUMN budget_used_json TEXT NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0,"calls":0,"costUsd":0,"wallTimeMs":0}' CHECK (json_valid(budget_used_json));
    ALTER TABLE runs ADD COLUMN revision_cycle INTEGER NOT NULL DEFAULT 0 CHECK (revision_cycle >= 0);
    ALTER TABLE runs ADD COLUMN pause_requested INTEGER NOT NULL DEFAULT 0 CHECK (pause_requested IN (0,1));
    ALTER TABLE runs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1));
    ALTER TABLE runs ADD COLUMN lease_owner TEXT;
    ALTER TABLE runs ADD COLUMN lease_expires_at TEXT;
    ALTER TABLE runs ADD COLUMN version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0);

    ALTER TABLE run_steps ADD COLUMN cycle INTEGER NOT NULL DEFAULT 0 CHECK (cycle >= 0);
    ALTER TABLE run_steps ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0);
    ALTER TABLE run_steps ADD COLUMN output_hash TEXT;
    ALTER TABLE run_steps ADD COLUMN updated_at TEXT;

    CREATE TABLE run_jobs (
      run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('queued','leased','waiting','finished')),
      priority INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL,
      lease_owner TEXT,
      lease_expires_at TEXT,
      last_error_json TEXT CHECK (last_error_json IS NULL OR json_valid(last_error_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX run_jobs_poll_idx ON run_jobs(status, available_at, priority DESC, created_at);

    CREATE TABLE run_budget_entries (
      id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT REFERENCES run_steps(id) ON DELETE SET NULL,
      call_id TEXT REFERENCES llm_calls(id) ON DELETE SET NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
      output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
      cost_usd REAL NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
      wall_time_ms INTEGER NOT NULL DEFAULT 0 CHECK (wall_time_ms >= 0),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX run_budget_entries_run_idx ON run_budget_entries(run_id, created_at);

    CREATE TABLE run_artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL REFERENCES run_steps(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      content_json TEXT NOT NULL CHECK (json_valid(content_json)),
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(run_id, kind, version)
    ) STRICT;

    CREATE INDEX run_artifacts_step_idx ON run_artifacts(step_id, created_at);

    CREATE TABLE review_reports (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL REFERENCES run_steps(id) ON DELETE CASCADE,
      document_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
      verdict TEXT NOT NULL CHECK (verdict IN ('pass','revise','block')),
      summary TEXT NOT NULL,
      score_json TEXT NOT NULL CHECK (json_valid(score_json)),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE review_issues (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL REFERENCES review_reports(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('info','minor','major','critical')),
      message TEXT NOT NULL,
      evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
      suggested_direction TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected','resolved')),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX review_issues_report_idx ON review_issues(report_id, severity, status);

    CREATE TABLE revision_proposals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL REFERENCES run_steps(id) ON DELETE CASCADE,
      base_document_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
      revised_content TEXT NOT NULL,
      diff_json TEXT NOT NULL CHECK (json_valid(diff_json)),
      addressed_issue_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(addressed_issue_ids_json)),
      status TEXT NOT NULL CHECK (status IN ('proposed','accepted','rejected','superseded')),
      created_at TEXT NOT NULL,
      decided_at TEXT
    ) STRICT;

    CREATE TABLE canon_change_sets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT NOT NULL REFERENCES run_steps(id) ON DELETE CASCADE,
      changes_json TEXT NOT NULL CHECK (json_valid(changes_json)),
      status TEXT NOT NULL CHECK (status IN ('candidate','partially_applied','applied','rejected')),
      created_at TEXT NOT NULL,
      decided_at TEXT
    ) STRICT;
  `,
} as const;
