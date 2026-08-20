export const migration017 = {
  version: 17,
  name: "profile-fk-to-models",
  // Rebuild-style migration: runs / autopilot_sessions / cocreate_sessions /
  // llm_calls are recreated with profile_id referencing models(id) instead of
  // the legacy model_profiles(id). Ids were copied 1:1 by migration 016, so
  // existing rows stay valid; the legacy tables remain untouched. The rebuild
  // drops referenced tables (runs), so foreign keys must stay off for the
  // duration of the migration.
  foreignKeysOff: true,
  sql: `
    CREATE TABLE runs_new (
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
      updated_at TEXT NOT NULL,
      recipe_version INTEGER NOT NULL DEFAULT 1 CHECK (recipe_version > 0),
      profile_id TEXT REFERENCES models(id) ON DELETE SET NULL,
      target_outline_node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL,
      budget_limit_json TEXT NOT NULL DEFAULT '{"maxInputTokens":500000,"maxOutputTokens":200000,"maxCalls":200,"maxCostUsd":null,"maxWallTimeMs":7200000}' CHECK (json_valid(budget_limit_json)),
      budget_used_json TEXT NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0,"calls":0,"costUsd":0,"wallTimeMs":0}' CHECK (json_valid(budget_used_json)),
      revision_cycle INTEGER NOT NULL DEFAULT 0 CHECK (revision_cycle >= 0),
      pause_requested INTEGER NOT NULL DEFAULT 0 CHECK (pause_requested IN (0,1)),
      cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1)),
      lease_owner TEXT,
      lease_expires_at TEXT,
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
    ) STRICT;
    INSERT INTO runs_new SELECT * FROM runs;
    DROP TABLE runs;
    ALTER TABLE runs_new RENAME TO runs;
    CREATE INDEX runs_project_status_idx ON runs(project_id, status, updated_at DESC);

    CREATE TABLE autopilot_sessions_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL REFERENCES models(id),
      mode TEXT NOT NULL CHECK (mode IN ('autopilot','chapter-gate')),
      status TEXT NOT NULL CHECK (status IN ('pending','planning','running','paused','awaiting_user','failed','cancelled','completed')),
      target_chapters INTEGER NOT NULL CHECK (target_chapters BETWEEN 1 AND 500),
      window_size INTEGER NOT NULL CHECK (window_size BETWEEN 1 AND 20),
      max_revision_cycles INTEGER NOT NULL CHECK (max_revision_cycles BETWEEN 0 AND 5),
      chapter_policy_json TEXT NOT NULL CHECK (json_valid(chapter_policy_json)),
      child_budget_json TEXT NOT NULL CHECK (json_valid(child_budget_json)),
      current_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      current_outline_node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL,
      completed_chapters INTEGER NOT NULL DEFAULT 0 CHECK (completed_chapters >= 0),
      skipped_chapters INTEGER NOT NULL DEFAULT 0 CHECK (skipped_chapters >= 0),
      pause_requested INTEGER NOT NULL DEFAULT 0 CHECK (pause_requested IN (0,1)),
      cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1)),
      replan_requested INTEGER NOT NULL DEFAULT 0 CHECK (replan_requested IN (0,1)),
      active_notes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(active_notes_json)),
      last_error_json TEXT CHECK (last_error_json IS NULL OR json_valid(last_error_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
    ) STRICT;
    INSERT INTO autopilot_sessions_new SELECT * FROM autopilot_sessions;
    DROP TABLE autopilot_sessions;
    ALTER TABLE autopilot_sessions_new RENAME TO autopilot_sessions;
    CREATE INDEX autopilot_sessions_poll_idx
      ON autopilot_sessions(status, pause_requested, cancel_requested, updated_at);
    CREATE INDEX autopilot_sessions_project_idx
      ON autopilot_sessions(project_id, created_at DESC);

    CREATE TABLE cocreate_sessions_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      profile_id TEXT NOT NULL REFERENCES models(id),
      status TEXT NOT NULL CHECK (status IN ('active','paused','archived')),
      speaker_policy TEXT NOT NULL CHECK (speaker_policy IN ('manual','round_robin','auto')),
      active_branch_id TEXT,
      target_outline_node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL,
      author_persona_id TEXT REFERENCES story_personas(id) ON DELETE SET NULL,
      director_note TEXT,
      context_turns INTEGER NOT NULL DEFAULT 24 CHECK (context_turns BETWEEN 4 AND 200),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
    ) STRICT;
    INSERT INTO cocreate_sessions_new SELECT * FROM cocreate_sessions;
    DROP TABLE cocreate_sessions;
    ALTER TABLE cocreate_sessions_new RENAME TO cocreate_sessions;
    CREATE INDEX cocreate_sessions_project_idx
      ON cocreate_sessions(project_id, status, updated_at DESC);

    CREATE TABLE llm_calls_new (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      step_id TEXT REFERENCES run_steps(id) ON DELETE SET NULL,
      profile_id TEXT NOT NULL REFERENCES models(id),
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
    INSERT INTO llm_calls_new SELECT * FROM llm_calls;
    DROP TABLE llm_calls;
    ALTER TABLE llm_calls_new RENAME TO llm_calls;
    CREATE INDEX llm_calls_run_idx ON llm_calls(run_id, started_at DESC);
  `,
} as const;
