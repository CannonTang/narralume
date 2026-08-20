export const migration006 = {
  version: 6,
  name: "delivery-and-portability",
  sql: `
    CREATE TABLE style_profiles (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      rules_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(rules_json)),
      examples_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(examples_json)),
      negative_rules_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(negative_rules_json)),
      source TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
      UNIQUE(project_id, name)
    ) STRICT;

    CREATE INDEX style_profiles_project_idx
      ON style_profiles(project_id, status, active DESC, updated_at DESC);
    CREATE UNIQUE INDEX style_profiles_one_active_idx
      ON style_profiles(project_id) WHERE active = 1 AND status = 'active';

    CREATE TABLE writing_skills (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      instructions TEXT NOT NULL,
      scopes_json TEXT NOT NULL DEFAULT '["all"]' CHECK (json_valid(scopes_json)),
      priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
      UNIQUE(project_id, name)
    ) STRICT;

    CREATE INDEX writing_skills_project_idx
      ON writing_skills(project_id, enabled DESC, priority DESC, name);

    CREATE TABLE import_batches (
      id TEXT PRIMARY KEY,
      target_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN ('markdown','text','epub','narrative-bundle')),
      source_hash TEXT NOT NULL,
      source_characters INTEGER NOT NULL CHECK (source_characters >= 0),
      status TEXT NOT NULL CHECK (status IN ('previewed','analyzing','ready','applied','discarded')),
      metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
      analysis_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      applied_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX import_batches_target_idx
      ON import_batches(target_project_id, status, created_at DESC);

    CREATE TABLE import_candidates (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('project','document','outline','intent','entity','style','skill')),
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      title TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
      status TEXT NOT NULL CHECK (status IN ('pending','selected','discarded','applied')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(batch_id, kind, ordinal)
    ) STRICT;

    CREATE INDEX import_candidates_batch_idx
      ON import_candidates(batch_id, status, ordinal);

    CREATE TABLE project_backups (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      bundle_json TEXT NOT NULL CHECK (json_valid(bundle_json)),
      bundle_hash TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      created_at TEXT NOT NULL,
      restored_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL
    ) STRICT;

    CREATE INDEX project_backups_project_idx
      ON project_backups(project_id, created_at DESC);
  `,
} as const;
