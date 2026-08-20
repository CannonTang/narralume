export const migration039 = {
  version: 39,
  name: "resource-lifecycle",
  sql: `
    ALTER TABLE timeline_events ADD COLUMN voided_at TEXT;
    CREATE INDEX timeline_events_active_idx
      ON timeline_events(project_id, voided_at, sequence, created_at);

    ALTER TABLE documents ADD COLUMN archived_at TEXT;
    CREATE INDEX documents_archive_idx
      ON documents(project_id, archived_at, updated_at DESC);
  `,
} as const;
