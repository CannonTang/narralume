import type { Migration } from "../database.js";

/**
 * B1 is a one-way convergence onto providers/models/assignments. Runtime
 * entities no longer carry a caller-selected profile and every LLM receipt
 * points directly at the physical model row used for the request.
 */
export const migration020 = {
  version: 20,
  name: "020-model-runtime-convergence",
  foreignKeysOff: true,
  sql: `
    ALTER TABLE models ADD COLUMN metadata_source TEXT NOT NULL DEFAULT 'migration'
      CHECK (metadata_source IN ('manual','environment','catalog','migration'));
    ALTER TABLE models ADD COLUMN metadata_verified_at TEXT;

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
      target_outline_node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL,
      budget_limit_json TEXT NOT NULL CHECK (json_valid(budget_limit_json)),
      budget_used_json TEXT NOT NULL CHECK (json_valid(budget_used_json)),
      revision_cycle INTEGER NOT NULL DEFAULT 0 CHECK (revision_cycle >= 0),
      pause_requested INTEGER NOT NULL DEFAULT 0 CHECK (pause_requested IN (0,1)),
      cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1)),
      lease_owner TEXT,
      lease_expires_at TEXT,
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
    ) STRICT;
    INSERT INTO runs_new(
      id, project_id, recipe, mode, status, policy_json, current_step_id,
      started_at, finished_at, created_at, updated_at, recipe_version,
      target_outline_node_id, budget_limit_json, budget_used_json,
      revision_cycle, pause_requested, cancel_requested, lease_owner,
      lease_expires_at, version
    ) SELECT
      id, project_id, recipe, mode, status, policy_json, current_step_id,
      started_at, finished_at, created_at, updated_at, recipe_version,
      target_outline_node_id, budget_limit_json, budget_used_json,
      revision_cycle, pause_requested, cancel_requested, lease_owner,
      lease_expires_at, version
    FROM runs;
    DROP TABLE runs;
    ALTER TABLE runs_new RENAME TO runs;
    CREATE INDEX runs_project_status_idx ON runs(project_id, status, updated_at DESC);

    CREATE TABLE autopilot_sessions_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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
    INSERT INTO autopilot_sessions_new(
      id, project_id, mode, status, target_chapters, window_size,
      max_revision_cycles, chapter_policy_json, child_budget_json,
      current_run_id, current_outline_node_id, completed_chapters,
      skipped_chapters, pause_requested, cancel_requested, replan_requested,
      active_notes_json, last_error_json, created_at, updated_at, finished_at,
      version
    ) SELECT
      id, project_id, mode, status, target_chapters, window_size,
      max_revision_cycles, chapter_policy_json, child_budget_json,
      current_run_id, current_outline_node_id, completed_chapters,
      skipped_chapters, pause_requested, cancel_requested, replan_requested,
      active_notes_json, last_error_json, created_at, updated_at, finished_at,
      version
    FROM autopilot_sessions;
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
    INSERT INTO cocreate_sessions_new(
      id, project_id, title, status, speaker_policy, active_branch_id,
      target_outline_node_id, author_persona_id, director_note, context_turns,
      created_at, updated_at, version
    ) SELECT
      id, project_id, title, status, speaker_policy, active_branch_id,
      target_outline_node_id, author_persona_id, director_note, context_turns,
      created_at, updated_at, version
    FROM cocreate_sessions;
    DROP TABLE cocreate_sessions;
    ALTER TABLE cocreate_sessions_new RENAME TO cocreate_sessions;
    CREATE INDEX cocreate_sessions_project_idx
      ON cocreate_sessions(project_id, status, updated_at DESC);

    CREATE TABLE llm_calls_new (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      step_id TEXT REFERENCES run_steps(id) ON DELETE SET NULL,
      model_id TEXT NOT NULL REFERENCES models(id),
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
      finished_at TEXT,
      details_json TEXT CHECK (details_json IS NULL OR json_valid(details_json))
    ) STRICT;
    INSERT INTO llm_calls_new(
      id, project_id, run_id, step_id, model_id, protocol, model, purpose,
      request_hash, status, response_id, finish_reason, usage_json, error_json,
      ttft_ms, duration_ms, started_at, finished_at, details_json
    ) SELECT
      id, project_id, run_id, step_id, profile_id, protocol, model, purpose,
      request_hash, status, response_id, finish_reason, usage_json, error_json,
      ttft_ms, duration_ms, started_at, finished_at, details_json
    FROM llm_calls;
    DROP TABLE llm_calls;
    ALTER TABLE llm_calls_new RENAME TO llm_calls;
    CREATE INDEX llm_calls_run_idx ON llm_calls(run_id, started_at DESC);

    CREATE TABLE model_assignment_snapshots (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      requested_role TEXT NOT NULL,
      assignment_role TEXT NOT NULL,
      model_id TEXT NOT NULL REFERENCES models(id),
      provider_json TEXT NOT NULL CHECK (json_valid(provider_json)),
      model_json TEXT NOT NULL CHECK (json_valid(model_json)),
      applied_json TEXT NOT NULL CHECK (json_valid(applied_json)),
      created_at TEXT NOT NULL,
      UNIQUE(run_id, purpose)
    ) STRICT;
    CREATE INDEX model_assignment_snapshots_run_idx
      ON model_assignment_snapshots(run_id, created_at);

    ALTER TABLE context_receipts ADD COLUMN inventory_digest TEXT;
    ALTER TABLE context_receipts ADD COLUMN materialization_digest TEXT;

    -- Migration 016 could only infer writing for legacy profiles. Remove
    -- role rows that therefore cannot satisfy the new task-type invariant;
    -- planning/review will explicitly fall back to the valid writing row.
    DELETE FROM model_assignments
    WHERE NOT EXISTS (
      SELECT 1 FROM models
      WHERE models.id = model_assignments.model_id
        AND models.task_type = model_assignments.role
    );

    DROP TABLE IF EXISTS model_routing_snapshots;
    DROP TABLE IF EXISTS run_model_snapshots;
    DROP TABLE IF EXISTS model_routing_rules;
    DROP TABLE IF EXISTS model_profiles;
  `,
} as const satisfies Migration;
