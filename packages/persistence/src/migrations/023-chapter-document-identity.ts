export const migration023 = {
  version: 23,
  name: "chapter-document-identity",
  foreignKeysOff: true,
  legacyRepairs: [
    {
      checksum:
        "87b6b3a74f72bc6d9739689c35c388a7def69badc4c4439d3fb8d0e2a8d43472",
      sql: "SELECT 1;",
    },
  ],
  sql: `
    CREATE TABLE documents_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      outline_node_id TEXT REFERENCES outline_nodes(id) ON DELETE SET NULL,
      current_version_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    INSERT INTO documents_new(
      id, project_id, kind, title, outline_node_id, current_version_id,
      created_at, updated_at
    )
    SELECT id, project_id, kind, title, NULL, current_version_id,
           created_at, updated_at
    FROM documents;

    DROP TABLE documents;
    ALTER TABLE documents_new RENAME TO documents;

    CREATE INDEX documents_project_kind_idx
      ON documents(project_id, kind, updated_at DESC);
    CREATE UNIQUE INDEX documents_outline_node_unique
      ON documents(project_id, outline_node_id)
      WHERE outline_node_id IS NOT NULL;
  `,
} as const;
