export const migration007 = {
  version: 7,
  name: "editing-safety-and-drafts",
  sql: `
    CREATE TABLE document_drafts (
      document_id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      base_version_id TEXT REFERENCES document_versions(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX document_drafts_project_idx
      ON document_drafts(project_id, updated_at DESC);
  `,
} as const;
