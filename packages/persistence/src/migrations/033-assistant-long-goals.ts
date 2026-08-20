export const migration033 = {
  version: 33,
  name: "assistant-long-goals",
  legacyRepairs: [
    {
      checksum:
        "99810c016ed2f8127ac584d6395974617f68a67a773e8b2c781f884f5402d053",
      sql: "SELECT 1;",
    },
  ],
  sql: `
    CREATE TABLE assistant_long_goals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
      activity_id TEXT NOT NULL REFERENCES assistant_activities(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      target_chapters INTEGER NOT NULL CHECK (target_chapters BETWEEN 1 AND 500),
      phase TEXT NOT NULL CHECK (phase IN ('foundation','outline','writing','done')),
      status TEXT NOT NULL CHECK (status IN (
        'active','paused_baseline','completed','failed','cancelled'
      )),
      baseline_hash TEXT NOT NULL,
      session_id TEXT REFERENCES autopilot_sessions(id) ON DELETE SET NULL,
      foundation_run_id TEXT,
      outline_session_id TEXT,
      last_error_json TEXT CHECK (last_error_json IS NULL OR json_valid(last_error_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0
    ) STRICT;

    CREATE UNIQUE INDEX assistant_long_goals_one_active
      ON assistant_long_goals(project_id)
      WHERE status IN ('active','paused_baseline');

    CREATE INDEX assistant_long_goals_project_created
      ON assistant_long_goals(project_id, created_at, id);

    CREATE TABLE assistant_activities_next (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES assistant_messages(id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK (kind IN ('tool_proposal','tool_execution','long_goal')),
      tool_name TEXT NOT NULL CHECK (tool_name IN (
        'story.inspect','review.inspect','foundation.start','chapter.start',
        'autopilot.start','outline.plan.start','canon.candidate.start',
        'selection.edit.start','long_goal.start','task.control'
      )),
      status TEXT NOT NULL CHECK (status IN (
        'proposed','running','completed','failed','cancelled','rejected'
      )),
      goal TEXT NOT NULL CHECK (length(trim(goal)) > 0),
      input_json TEXT NOT NULL CHECK (json_valid(input_json)),
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
      source_type TEXT CHECK (source_type IS NULL OR source_type IN ('run','autopilot','long_goal')),
      source_id TEXT,
      origin_json TEXT CHECK (origin_json IS NULL OR json_valid(origin_json)),
      execution_mode TEXT CHECK (execution_mode IS NULL OR execution_mode IN ('auto','confirm')),
      skill_id TEXT,
      phase_key TEXT,
      artifacts_json TEXT CHECK (artifacts_json IS NULL OR json_valid(artifacts_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (source_type IS NULL AND source_id IS NULL) OR
        (source_type IS NOT NULL AND source_id IS NOT NULL)
      )
    ) STRICT;

    INSERT INTO assistant_activities_next (
      id, conversation_id, message_id, kind, tool_name, status, goal,
      input_json, result_json, error_json, source_type, source_id, origin_json,
      execution_mode, skill_id, phase_key, artifacts_json,
      created_at, updated_at
    )
    SELECT
      id, conversation_id, message_id, kind, tool_name, status, goal,
      input_json, result_json, error_json, source_type, source_id, origin_json,
      execution_mode, skill_id, phase_key, artifacts_json,
      created_at, updated_at
    FROM assistant_activities;

    DROP TABLE assistant_activities;
    ALTER TABLE assistant_activities_next RENAME TO assistant_activities;

    CREATE INDEX assistant_activities_conversation_created
      ON assistant_activities(conversation_id, created_at, id);
  `,
  foreignKeysOff: true,
} as const;
