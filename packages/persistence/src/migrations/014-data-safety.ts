export const migration014 = {
  version: 14,
  name: "data-safety",
  sql: `
    ALTER TABLE projects ADD COLUMN deleted_at TEXT;
    ALTER TABLE projects ADD COLUMN deletion_token TEXT;
    ALTER TABLE projects ADD COLUMN delete_after TEXT;

    CREATE INDEX projects_deleted_idx
      ON projects(deleted_at, delete_after, updated_at DESC);

    CREATE TABLE narrative_state_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('timeline','foreshadow')),
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('create','update')),
      before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
      after_json TEXT NOT NULL CHECK (json_valid(after_json)),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX narrative_state_revisions_entity_idx
      ON narrative_state_revisions(project_id, entity_type, entity_id, id DESC);
  `,
} as const;
