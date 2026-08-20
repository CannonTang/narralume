export const migration031 = {
  version: 31,
  name: "collaboration-versions",
  sql: `
    ALTER TABLE story_personas
      ADD COLUMN version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0);
  `,
} as const;
