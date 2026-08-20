export const migration034 = {
  version: 34,
  name: "project-backup-counts",
  sql: `
    ALTER TABLE project_backups ADD COLUMN counts_json TEXT
      CHECK (counts_json IS NULL OR json_valid(counts_json));
  `,
} as const;
