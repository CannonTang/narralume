export const migration001 = {
  version: 1,
  name: "foundation",
  sql: `
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      subtitle TEXT,
      premise TEXT,
      language TEXT NOT NULL DEFAULT 'zh-CN',
      phase TEXT NOT NULL CHECK (phase IN ('idea','foundation','outlining','writing','revising','complete')),
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX projects_updated_idx ON projects(archived_at, updated_at DESC);

    CREATE TABLE model_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK (protocol IN ('openai-chat','openai-responses','anthropic-messages')),
      base_url TEXT NOT NULL,
      endpoint TEXT,
      model TEXT NOT NULL,
      api_key_env TEXT NOT NULL,
      anthropic_version TEXT,
      extra_headers_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_headers_json)),
      capabilities_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(capabilities_json)),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      current_version_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, kind, title)
    ) STRICT;

    CREATE TABLE document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      parent_version_id TEXT REFERENCES document_versions(id),
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      source TEXT NOT NULL,
      run_id TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX document_versions_document_idx
      ON document_versions(document_id, created_at DESC);

    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      recipe TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('autopilot','chapter-gate','director','co-create','manual')),
      status TEXT NOT NULL CHECK (status IN ('pending','running','paused','awaiting_user','failed_recoverable','failed','cancelled','completed')),
      policy_json TEXT NOT NULL CHECK (json_valid(policy_json)),
      current_step_id TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX runs_project_status_idx ON runs(project_id, status, updated_at DESC);

    CREATE TABLE run_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      kind TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','skipped','cancelled')),
      idempotency_key TEXT NOT NULL,
      input_hash TEXT,
      output_artifact_json TEXT CHECK (output_artifact_json IS NULL OR json_valid(output_artifact_json)),
      error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
      attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(run_id, idempotency_key)
    ) STRICT;

    CREATE INDEX run_steps_run_ordinal_idx ON run_steps(run_id, ordinal);

    CREATE TABLE run_events (
      id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT REFERENCES run_steps(id) ON DELETE SET NULL,
      sequence INTEGER NOT NULL CHECK (sequence >= 0),
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      created_at TEXT NOT NULL,
      UNIQUE(run_id, sequence)
    ) STRICT;

    CREATE TABLE checkpoints (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      step_id TEXT REFERENCES run_steps(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      state_json TEXT NOT NULL CHECK (json_valid(state_json)),
      state_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX checkpoints_run_idx ON checkpoints(run_id, created_at DESC);

    CREATE TABLE llm_calls (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      step_id TEXT REFERENCES run_steps(id) ON DELETE SET NULL,
      profile_id TEXT NOT NULL REFERENCES model_profiles(id),
      protocol TEXT NOT NULL,
      model TEXT NOT NULL,
      purpose TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('started','streaming','completed','failed','cancelled')),
      response_id TEXT,
      finish_reason TEXT,
      usage_json TEXT CHECK (usage_json IS NULL OR json_valid(usage_json)),
      error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
      ttft_ms INTEGER,
      duration_ms INTEGER,
      started_at TEXT NOT NULL,
      finished_at TEXT
    ) STRICT;

    CREATE INDEX llm_calls_run_idx ON llm_calls(run_id, started_at DESC);

    CREATE TABLE tool_calls (
      id TEXT PRIMARY KEY,
      llm_call_id TEXT REFERENCES llm_calls(id) ON DELETE SET NULL,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      arguments_hash TEXT NOT NULL,
      permission TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','denied','cancelled')),
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(run_id, name, arguments_hash)
    ) STRICT;

    CREATE TABLE context_receipts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      step_id TEXT REFERENCES run_steps(id) ON DELETE SET NULL,
      purpose TEXT NOT NULL,
      budget_json TEXT NOT NULL CHECK (json_valid(budget_json)),
      entries_json TEXT NOT NULL CHECK (json_valid(entries_json)),
      compiled_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE operation_log (
      id INTEGER PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      turn_id TEXT,
      operation TEXT NOT NULL,
      entity_table TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
      after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX operation_log_project_idx
      ON operation_log(project_id, created_at DESC);
  `,
} as const;
