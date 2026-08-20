export const migration029 = {
  version: 29,
  name: "request-replays",
  sql: `
    CREATE TABLE request_replays (
      scope TEXT NOT NULL,
      request_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL CHECK (json_valid(result_json)),
      created_at TEXT NOT NULL,
      PRIMARY KEY(scope, request_id)
    ) STRICT, WITHOUT ROWID;
  `,
} as const;
