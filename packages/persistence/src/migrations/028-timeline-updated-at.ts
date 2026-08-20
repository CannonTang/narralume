export const migration028 = {
  version: 28,
  name: "timeline-updated-at",
  sql: `
    ALTER TABLE timeline_events ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
    UPDATE timeline_events SET updated_at = created_at WHERE updated_at = '';
  `,
} as const;
