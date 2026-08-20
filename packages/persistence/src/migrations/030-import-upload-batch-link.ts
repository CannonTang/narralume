export const migration030 = {
  version: 30,
  name: "import-upload-batch-link",
  sql: `
    ALTER TABLE import_upload_sessions
      ADD COLUMN batch_id TEXT REFERENCES import_batches(id) ON DELETE SET NULL;
  `,
} as const;
