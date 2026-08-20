export const migration024 = {
  version: 24,
  name: "normalize-current-document-segments",
  sql: `
    DELETE FROM text_segments WHERE source_type = 'document_version';
  `,
} as const;
