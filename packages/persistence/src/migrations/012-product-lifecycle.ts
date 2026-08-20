export const migration012 = {
  version: 12,
  name: "product-lifecycle-and-chunked-imports",
  sql: `
    DROP INDEX import_candidates_batch_idx;
    DROP INDEX import_batches_target_idx;
    ALTER TABLE import_candidates RENAME TO import_candidates_v11;
    ALTER TABLE import_batches RENAME TO import_batches_v11;

    CREATE TABLE import_batches (
      id TEXT PRIMARY KEY,
      target_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN ('markdown','text','docx','html','epub','narrative-bundle')),
      source_hash TEXT NOT NULL,
      source_characters INTEGER NOT NULL CHECK (source_characters >= 0),
      status TEXT NOT NULL CHECK (status IN ('previewed','analyzing','ready','applied','discarded')),
      metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
      analysis_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
      applied_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    INSERT INTO import_batches
      SELECT * FROM import_batches_v11;

    CREATE INDEX import_batches_target_idx
      ON import_batches(target_project_id, status, created_at DESC);

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
      SELECT * FROM import_candidates_v11;

    CREATE INDEX import_candidates_batch_idx
      ON import_candidates(batch_id, status, ordinal);

    DROP TABLE import_candidates_v11;
    DROP TABLE import_batches_v11;

    CREATE TABLE import_upload_sessions (
      id TEXT PRIMARY KEY,
      target_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN ('markdown','text','docx','html','epub','narrative-bundle')),
      total_bytes INTEGER NOT NULL CHECK (total_bytes BETWEEN 1 AND 268435456),
      chunk_size INTEGER NOT NULL CHECK (chunk_size BETWEEN 65536 AND 8388608),
      expected_hash TEXT,
      status TEXT NOT NULL CHECK (status IN ('uploading','completed','expired','discarded')),
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE import_upload_chunks (
      session_id TEXT NOT NULL REFERENCES import_upload_sessions(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
      content_base64 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
      chunk_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(session_id, chunk_index)
    ) STRICT;

    CREATE INDEX import_upload_sessions_status_idx
      ON import_upload_sessions(status, expires_at);
  `,
} as const;
