import type { NarrativeDatabase } from "./database.js";
import { PersistenceNotFoundError } from "./project-repository.js";

export interface RunTextStream {
  runId: string;
  stepId: string;
  attempt: number;
  content: string;
  status: "streaming" | "completed" | "interrupted";
  updatedAt: string;
}

export class SqliteRunStreamRepository {
  constructor(private readonly database: NarrativeDatabase) {}

  appendText(runId: string, stepId: string, text: string, now: string): void {
    if (!text) return;
    const step = this.requireStep(runId, stepId);
    this.database.raw
      .prepare(
        `INSERT INTO run_stream_attempts(
           run_id, step_id, attempt, content, status, updated_at
         ) VALUES (?, ?, ?, ?, 'streaming', ?)
         ON CONFLICT(step_id, attempt) DO UPDATE SET
           content = run_stream_attempts.content || excluded.content,
           status = 'streaming',
           updated_at = excluded.updated_at`,
      )
      .run(runId, stepId, step.attempt, text, now);
  }

  markStatus(
    runId: string,
    stepId: string,
    status: RunTextStream["status"],
    now: string,
  ): void {
    const step = this.requireStep(runId, stepId);
    this.database.raw
      .prepare(
        `UPDATE run_stream_attempts SET status = ?, updated_at = ?
         WHERE run_id = ? AND step_id = ? AND attempt = ?`,
      )
      .run(status, now, runId, stepId, step.attempt);
  }

  interruptOrphaned(now = new Date().toISOString()): number {
    return Number(
      this.database.raw
        .prepare(
          `UPDATE run_stream_attempts SET status = 'interrupted', updated_at = ?
           WHERE status = 'streaming'`,
        )
        .run(now).changes,
    );
  }

  listForRun(runId: string): RunTextStream[] {
    const rows = this.database.raw
      .prepare(
        `SELECT * FROM run_stream_attempts
         WHERE run_id = ? ORDER BY step_id, attempt`,
      )
      .all(runId) as unknown as RunTextStreamRow[];
    return rows.map(mapRow);
  }

  get(runId: string, stepId: string, attempt: number): RunTextStream | null {
    const row = this.database.raw
      .prepare(
        `SELECT * FROM run_stream_attempts
         WHERE run_id = ? AND step_id = ? AND attempt = ?`,
      )
      .get(runId, stepId, attempt) as RunTextStreamRow | undefined;
    return row ? mapRow(row) : null;
  }

  discard(runId: string, stepId: string, attempt: number): boolean {
    return (
      this.database.raw
        .prepare(
          `DELETE FROM run_stream_attempts
           WHERE run_id = ? AND step_id = ? AND attempt = ?`,
        )
        .run(runId, stepId, attempt).changes === 1
    );
  }

  private requireStep(runId: string, stepId: string): { attempt: number } {
    const row = this.database.raw
      .prepare("SELECT attempt FROM run_steps WHERE run_id = ? AND id = ?")
      .get(runId, stepId) as { attempt: number } | undefined;
    if (!row || row.attempt < 1)
      throw new PersistenceNotFoundError("running-step", stepId);
    return row;
  }
}

interface RunTextStreamRow {
  run_id: string;
  step_id: string;
  attempt: number;
  content: string;
  status: RunTextStream["status"];
  updated_at: string;
}

function mapRow(row: RunTextStreamRow): RunTextStream {
  return {
    runId: row.run_id,
    stepId: row.step_id,
    attempt: row.attempt,
    content: row.content,
    status: row.status,
    updatedAt: row.updated_at,
  };
}
