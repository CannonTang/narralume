const previewMigrationRepair = {
  checksum: "6968540a82fc1e30f3b4d5656cdafd058892e2cf11f8f38ef50d7d1998f48999",
  sql: `
    DROP INDEX import_candidates_batch_idx;
    ALTER TABLE import_candidates RENAME TO import_candidates_preview_v11;
    CREATE TABLE import_candidates (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN (
        'project','document','outline','intent','entity','style','skill',
        'relationship','timeline','foreshadow','character-arc','scene-analysis'
      )),
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      title TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      status TEXT NOT NULL CHECK (status IN ('pending','selected','discarded','applied')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(batch_id, kind, ordinal)
    ) STRICT;
    INSERT INTO import_candidates
      SELECT * FROM import_candidates_preview_v11;
    DROP TABLE import_candidates_preview_v11;
    CREATE INDEX import_candidates_batch_idx
      ON import_candidates(batch_id, status, ordinal);

    DROP INDEX narrative_memories_project_idx;
    ALTER TABLE narrative_memories RENAME TO narrative_memories_preview_v11;
    CREATE TABLE narrative_memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      layer TEXT NOT NULL CHECK (layer IN ('working','episodic','semantic')),
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      state_delta_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(state_delta_json)),
      source_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active','stale','retired')),
      refreshed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, layer, scope_type, scope_id, source_hash)
    ) STRICT;
    INSERT INTO narrative_memories(
      id, project_id, layer, scope_type, scope_id, title, content,
      state_delta_json, source_hash, status, refreshed_at, created_at, updated_at
    )
      SELECT
        id, project_id, layer, scope_type, scope_id, title, content,
        state_delta_json, source_hash, status, refreshed_at, created_at, updated_at
      FROM narrative_memories_preview_v11;
    DROP TABLE narrative_memories_preview_v11;
    CREATE INDEX narrative_memories_project_idx
      ON narrative_memories(project_id, status, layer, updated_at DESC);
    CREATE UNIQUE INDEX narrative_memories_active_scope_idx
      ON narrative_memories(project_id, layer, scope_type, scope_id)
      WHERE status = 'active';

    CREATE TABLE model_routing_rules (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL UNIQUE,
      primary_profile_id TEXT NOT NULL REFERENCES model_profiles(id),
      fallback_profile_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(fallback_profile_ids_json)),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE run_model_snapshots (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      role TEXT NOT NULL,
      selected_profile_id TEXT NOT NULL,
      candidate_profile_ids_json TEXT NOT NULL CHECK (json_valid(candidate_profile_ids_json)),
      profile_json TEXT NOT NULL CHECK (json_valid(profile_json)),
      created_at TEXT NOT NULL,
      UNIQUE(run_id, purpose)
    ) STRICT;

    CREATE TABLE writing_skill_references (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES writing_skills(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(skill_id, path)
    ) STRICT;

    CREATE TABLE harness_templates (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('prompt','recipe')),
      template_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      system_invariants TEXT NOT NULL,
      default_content TEXT NOT NULL,
      override_content TEXT,
      cloned_from_key TEXT,
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
      updated_at TEXT NOT NULL
    ) STRICT;
  `,
} as const;

export const migration011 = {
  version: 11,
  name: "long-novel-intelligence",
  sql: `
    ALTER TABLE import_candidates RENAME TO import_candidates_legacy;
    CREATE TABLE import_candidates (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN (
        'project','document','outline','intent','entity','style','skill',
        'relationship','timeline','foreshadow','character-arc','scene-analysis'
      )),
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      title TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      status TEXT NOT NULL CHECK (status IN ('pending','selected','discarded','applied')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(batch_id, kind, ordinal)
    ) STRICT;
    INSERT INTO import_candidates
      SELECT * FROM import_candidates_legacy;
    DROP TABLE import_candidates_legacy;
    CREATE INDEX import_candidates_batch_idx
      ON import_candidates(batch_id, status, ordinal);

    CREATE TABLE segment_embeddings (
      segment_id TEXT PRIMARY KEY REFERENCES text_segments(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL CHECK (dimensions > 0),
      embedding_json TEXT NOT NULL CHECK (json_valid(embedding_json)),
      content_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE narrative_memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      layer TEXT NOT NULL CHECK (layer IN ('working','episodic','semantic')),
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      state_delta_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(state_delta_json)),
      source_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active','stale','retired')),
      refreshed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, layer, scope_type, scope_id, source_hash)
    ) STRICT;

    CREATE INDEX narrative_memories_project_idx
      ON narrative_memories(project_id, status, layer, updated_at DESC);
    CREATE UNIQUE INDEX narrative_memories_active_scope_idx
      ON narrative_memories(project_id, layer, scope_type, scope_id)
      WHERE status = 'active';

    CREATE TABLE plot_predictions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      horizon INTEGER NOT NULL CHECK (horizon BETWEEN 1 AND 20),
      summary TEXT NOT NULL,
      impact_json TEXT NOT NULL CHECK (json_valid(impact_json)),
      risks_json TEXT NOT NULL CHECK (json_valid(risks_json)),
      uncertainty REAL NOT NULL CHECK (uncertainty >= 0 AND uncertainty <= 1),
      context_fingerprint TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('candidate','adopted','dismissed')),
      source_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(source_ids_json)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX plot_predictions_project_idx
      ON plot_predictions(project_id, status, created_at DESC);

    CREATE TABLE model_routing_rules (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL UNIQUE,
      primary_profile_id TEXT NOT NULL REFERENCES model_profiles(id),
      fallback_profile_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(fallback_profile_ids_json)),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE run_model_snapshots (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      role TEXT NOT NULL,
      selected_profile_id TEXT NOT NULL,
      candidate_profile_ids_json TEXT NOT NULL CHECK (json_valid(candidate_profile_ids_json)),
      profile_json TEXT NOT NULL CHECK (json_valid(profile_json)),
      created_at TEXT NOT NULL,
      UNIQUE(run_id, purpose)
    ) STRICT;

    CREATE TABLE writing_skill_references (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES writing_skills(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(skill_id, path)
    ) STRICT;

    CREATE TABLE harness_templates (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('prompt','recipe')),
      template_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      system_invariants TEXT NOT NULL,
      default_content TEXT NOT NULL,
      override_content TEXT,
      cloned_from_key TEXT,
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
      updated_at TEXT NOT NULL
    ) STRICT;
  `,
  legacyRepairs: [previewMigrationRepair],
} as const;
