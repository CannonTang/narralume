import type { NarrativeDatabase } from "./database.js";

export interface ModelAssignmentSnapshot {
  id: string;
  runId: string;
  purpose: string;
  requestedRole: string;
  assignmentRole: string;
  modelId: string;
  provider: Record<string, unknown>;
  model: Record<string, unknown>;
  applied: Record<string, unknown>;
  createdAt: string;
}

interface SnapshotRow {
  id: string;
  run_id: string;
  purpose: string;
  requested_role: string;
  assignment_role: string;
  model_id: string;
  provider_json: string;
  model_json: string;
  applied_json: string;
  created_at: string;
}

export class SqliteModelAssignmentSnapshotRepository {
  constructor(private readonly database: NarrativeDatabase) {}

  upsert(snapshot: ModelAssignmentSnapshot): ModelAssignmentSnapshot {
    this.database.raw
      .prepare(
        `INSERT INTO model_assignment_snapshots(
           id, run_id, purpose, requested_role, assignment_role, model_id,
           provider_json, model_json, applied_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, purpose) DO UPDATE SET
           applied_json = excluded.applied_json`,
      )
      .run(
        snapshot.id,
        snapshot.runId,
        snapshot.purpose,
        snapshot.requestedRole,
        snapshot.assignmentRole,
        snapshot.modelId,
        JSON.stringify(snapshot.provider),
        JSON.stringify(snapshot.model),
        JSON.stringify(snapshot.applied),
        snapshot.createdAt,
      );
    return snapshot;
  }

  get(runId: string, purpose: string): ModelAssignmentSnapshot | null {
    const row = this.database.raw
      .prepare(
        `SELECT * FROM model_assignment_snapshots
         WHERE run_id = ? AND purpose = ?`,
      )
      .get(runId, purpose) as SnapshotRow | undefined;
    return row ? mapSnapshot(row) : null;
  }

  listForRun(runId: string): ModelAssignmentSnapshot[] {
    const rows = this.database.raw
      .prepare(
        `SELECT * FROM model_assignment_snapshots
         WHERE run_id = ? ORDER BY created_at, purpose`,
      )
      .all(runId) as unknown as SnapshotRow[];
    return rows.map(mapSnapshot);
  }
}

function mapSnapshot(row: SnapshotRow): ModelAssignmentSnapshot {
  return {
    id: row.id,
    runId: row.run_id,
    purpose: row.purpose,
    requestedRole: row.requested_role,
    assignmentRole: row.assignment_role,
    modelId: row.model_id,
    provider: JSON.parse(row.provider_json) as Record<string, unknown>,
    model: JSON.parse(row.model_json) as Record<string, unknown>,
    applied: JSON.parse(row.applied_json) as Record<string, unknown>,
    createdAt: row.created_at,
  };
}
