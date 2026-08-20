import type { Migration } from "../database.js";

/**
 * Records the durable result of the product-level "create project and start
 * foundation" command. The row is committed in the same transaction as both
 * resources, so a client retry can safely return the original project/run.
 */
export const migration022 = {
  version: 22,
  name: "022-project-foundation-requests",
  sql: `
    CREATE TABLE project_foundation_requests (
      request_id TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
      run_id TEXT NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    ) STRICT;
  `,
} as const satisfies Migration;
