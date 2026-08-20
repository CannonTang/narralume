export const migration026 = {
  version: 26,
  name: "canon-candidate-decisions",
  sql: `
    CREATE TABLE canon_change_set_item_decisions (
      change_set_id TEXT NOT NULL REFERENCES canon_change_sets(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('apply','reject')),
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      created_at TEXT NOT NULL,
      PRIMARY KEY (change_set_id, item_id)
    ) STRICT;

    CREATE INDEX canon_change_set_item_decisions_created
      ON canon_change_set_item_decisions(change_set_id, created_at, item_id);
  `,
} as const;
