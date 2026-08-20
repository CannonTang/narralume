import type { NarrativeDatabase } from "./database.js";

export interface ProjectFoundationRequestRecord {
  requestId: string;
  requestHash: string;
  projectId: string;
  runId: string;
  createdAt: string;
}

export class SqliteProjectCreationRepository {
  constructor(private readonly database: NarrativeDatabase) {}

  get(requestId: string): ProjectFoundationRequestRecord | null {
    const row = this.database.raw
      .prepare("SELECT * FROM project_foundation_requests WHERE request_id = ?")
      .get(requestId) as ProjectFoundationRequestRow | undefined;
    return row ? mapRecord(row) : null;
  }

  insert(
    record: ProjectFoundationRequestRecord,
  ): ProjectFoundationRequestRecord {
    this.database.raw
      .prepare(
        `INSERT INTO project_foundation_requests(
          request_id, request_hash, project_id, run_id, created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        record.requestId,
        record.requestHash,
        record.projectId,
        record.runId,
        record.createdAt,
      );
    return record;
  }
}

interface ProjectFoundationRequestRow {
  request_id: string;
  request_hash: string;
  project_id: string;
  run_id: string;
  created_at: string;
}

function mapRecord(
  row: ProjectFoundationRequestRow,
): ProjectFoundationRequestRecord {
  return {
    requestId: row.request_id,
    requestHash: row.request_hash,
    projectId: row.project_id,
    runId: row.run_id,
    createdAt: row.created_at,
  };
}
