export const migration004 = {
  version: 4,
  name: "autonomous-production",
  sql: `
    CREATE TABLE story_compasses (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      core_promise TEXT NOT NULL,
      ending_direction TEXT,
      long_lines_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(long_lines_json)),
      theme_questions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(theme_questions_json)),
      target_json TEXT NOT NULL CHECK (json_valid(target_json)),
      constraints_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(constraints_json)),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE foundation_candidate_sets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open','partially_adopted','adopted','discarded')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, source_run_id)
    ) STRICT;

    CREATE TABLE foundation_candidates (
      id TEXT PRIMARY KEY,
      set_id TEXT NOT NULL REFERENCES foundation_candidate_sets(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('intent','compass','entity')),
      label TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      edited_payload_json TEXT CHECK (edited_payload_json IS NULL OR json_valid(edited_payload_json)),
      status TEXT NOT NULL CHECK (status IN ('pending','adopted','discarded')),
      adopted_ref_type TEXT,
      adopted_ref_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX foundation_candidates_set_idx
      ON foundation_candidates(set_id, status, kind, created_at);

    CREATE TABLE autopilot_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL REFERENCES model_profiles(id),
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

    CREATE INDEX autopilot_sessions_poll_idx
      ON autopilot_sessions(status, pause_requested, cancel_requested, updated_at);
    CREATE INDEX autopilot_sessions_project_idx
      ON autopilot_sessions(project_id, created_at DESC);

    CREATE TABLE autopilot_run_links (
      session_id TEXT NOT NULL REFERENCES autopilot_sessions(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('rolling-plan','chapter','closing-review')),
      outline_node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL,
      sequence INTEGER NOT NULL CHECK (sequence >= 0),
      created_at TEXT NOT NULL,
      processed_at TEXT,
      outcome TEXT,
      PRIMARY KEY(session_id, run_id),
      UNIQUE(session_id, sequence)
    ) WITHOUT ROWID;

    CREATE INDEX autopilot_run_links_run_idx ON autopilot_run_links(run_id);

    CREATE TABLE story_steers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES autopilot_sessions(id) ON DELETE CASCADE,
      target_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      classification TEXT CHECK (classification IS NULL OR classification IN ('immediate_current','next_scene','future_plan','canon_change','rewrite_existing','temporary_director_note')),
      status TEXT NOT NULL CHECK (status IN ('pending','classifying','classified','applied','awaiting_confirmation','rejected')),
      effective_boundary TEXT NOT NULL CHECK (effective_boundary IN ('immediate','next_scene','next_chapter','future')),
      rationale TEXT,
      risk TEXT CHECK (risk IS NULL OR risk IN ('low','medium','high')),
      classification_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      applied_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX story_steers_session_idx
      ON story_steers(session_id, status, created_at);

    CREATE TABLE planning_reviews (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES autopilot_sessions(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('arc','volume')),
      outline_node_id TEXT NOT NULL REFERENCES outline_nodes(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      scores_json TEXT NOT NULL CHECK (json_valid(scores_json)),
      recommendations_json TEXT NOT NULL CHECK (json_valid(recommendations_json)),
      source_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(session_id, scope_type, outline_node_id, source_hash)
    ) STRICT;

    CREATE INDEX planning_reviews_session_idx
      ON planning_reviews(session_id, created_at);
  `,
} as const;
