export const migration005 = {
  version: 5,
  name: "cocreate-studio",
  sql: `
    CREATE TABLE story_personas (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('author','narrator','character')),
      entity_id TEXT REFERENCES canon_entities(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      description TEXT,
      instructions TEXT NOT NULL DEFAULT '',
      voice_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(voice_json)),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, name)
    ) STRICT;

    CREATE INDEX story_personas_project_idx
      ON story_personas(project_id, status, kind, name);

    CREATE TABLE cocreate_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      profile_id TEXT NOT NULL REFERENCES model_profiles(id),
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

    CREATE INDEX cocreate_sessions_project_idx
      ON cocreate_sessions(project_id, status, updated_at DESC);

    CREATE TABLE cocreate_participants (
      session_id TEXT NOT NULL REFERENCES cocreate_sessions(id) ON DELETE CASCADE,
      persona_id TEXT NOT NULL REFERENCES story_personas(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      talkativeness REAL NOT NULL DEFAULT 0.5 CHECK (talkativeness >= 0 AND talkativeness <= 1),
      created_at TEXT NOT NULL,
      PRIMARY KEY(session_id, persona_id),
      UNIQUE(session_id, position)
    ) WITHOUT ROWID;

    CREATE TABLE story_branches (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES cocreate_sessions(id) ON DELETE CASCADE,
      parent_branch_id TEXT REFERENCES story_branches(id) ON DELETE CASCADE,
      forked_from_turn_id TEXT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
      head_turn_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX story_branches_session_idx
      ON story_branches(session_id, status, created_at);

    CREATE TABLE story_turns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES cocreate_sessions(id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL REFERENCES story_branches(id) ON DELETE CASCADE,
      parent_turn_id TEXT REFERENCES story_turns(id) ON DELETE SET NULL,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      role TEXT NOT NULL CHECK (role IN ('user','assistant','director','system')),
      persona_id TEXT REFERENCES story_personas(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','reverted','adopted')),
      selected_swipe_id TEXT,
      source_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(branch_id, ordinal)
    ) STRICT;

    CREATE INDEX story_turns_branch_idx
      ON story_turns(branch_id, status, ordinal);

    CREATE TABLE turn_swipes (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL REFERENCES story_turns(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      content TEXT NOT NULL,
      speaker_persona_id TEXT REFERENCES story_personas(id) ON DELETE SET NULL,
      source_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK (status IN ('candidate','selected','rejected')),
      metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
      created_at TEXT NOT NULL,
      UNIQUE(turn_id, ordinal)
    ) STRICT;

    CREATE INDEX turn_swipes_turn_idx ON turn_swipes(turn_id, ordinal);

    CREATE TABLE scene_adoptions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES cocreate_sessions(id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL REFERENCES story_branches(id) ON DELETE CASCADE,
      from_turn_id TEXT NOT NULL REFERENCES story_turns(id),
      to_turn_id TEXT NOT NULL REFERENCES story_turns(id),
      outline_node_id TEXT NOT NULL REFERENCES outline_nodes(id),
      document_id TEXT NOT NULL REFERENCES documents(id),
      document_version_id TEXT NOT NULL REFERENCES document_versions(id),
      run_id TEXT NOT NULL REFERENCES runs(id),
      canon_change_set_id TEXT REFERENCES canon_change_sets(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      UNIQUE(session_id, branch_id, from_turn_id, to_turn_id)
    ) STRICT;

    CREATE TABLE document_comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
      start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
      end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
      quote TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX document_comments_document_idx
      ON document_comments(document_id, status, created_at DESC);

    CREATE TABLE edit_proposals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      base_version_id TEXT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      instruction TEXT NOT NULL,
      selection_start INTEGER NOT NULL CHECK (selection_start >= 0),
      selection_end INTEGER NOT NULL CHECK (selection_end > selection_start),
      original_text TEXT NOT NULL,
      replacement_text TEXT NOT NULL,
      proposed_content TEXT NOT NULL,
      diff_json TEXT NOT NULL CHECK (json_valid(diff_json)),
      status TEXT NOT NULL CHECK (status IN ('proposed','accepted','rejected','superseded')),
      accepted_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT
    ) STRICT;

    CREATE INDEX edit_proposals_document_idx
      ON edit_proposals(document_id, status, created_at DESC);
  `,
} as const;
