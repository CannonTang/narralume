import type {
  FinishReason,
  ModelProtocol,
  NormalizedUsage,
} from "@narrative-lantern/llm";

import type { NarrativeDatabase } from "./database.js";
import { PersistenceNotFoundError } from "./project-repository.js";

export interface LlmCallStart {
  id: string;
  projectId: string;
  runId: string;
  stepId: string;
  modelId: string;
  protocol: ModelProtocol;
  model: string;
  purpose: string;
  requestHash: string;
  startedAt: string;
}

export class SqliteLlmCallRepository {
  constructor(private readonly database: NarrativeDatabase) {}

  start(call: LlmCallStart): void {
    this.database.raw
      .prepare(
        `INSERT INTO llm_calls(
          id, project_id, run_id, step_id, model_id, protocol, model, purpose,
          request_hash, status, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'started', ?)`,
      )
      .run(
        call.id,
        call.projectId,
        call.runId,
        call.stepId,
        call.modelId,
        call.protocol,
        call.model,
        call.purpose,
        call.requestHash,
        call.startedAt,
      );
  }

  complete(
    id: string,
    result: {
      responseId?: string;
      finishReason: FinishReason;
      usage: NormalizedUsage;
      ttftMs?: number | null;
      durationMs: number;
      finishedAt: string;
      /**
       * Success-side receipt details persisted to llm_calls.details_json.
       * Used for repairAttempts (structured calls ledger one row per logical
       * call, so physical repair attempts are counted here) and the
       * transport-measured totalDurationMs.
       */
      details?: Readonly<Record<string, unknown>>;
    },
  ): void {
    const changed = this.database.raw
      .prepare(
        `UPDATE llm_calls SET status = 'completed', response_id = ?, finish_reason = ?,
           usage_json = ?, ttft_ms = ?, duration_ms = ?, finished_at = ?, details_json = ?
           WHERE id = ?`,
      )
      .run(
        result.responseId ?? null,
        result.finishReason,
        JSON.stringify(result.usage),
        result.ttftMs ?? null,
        result.durationMs,
        result.finishedAt,
        result.details ? JSON.stringify(result.details) : null,
        id,
      );
    if (changed.changes !== 1)
      throw new PersistenceNotFoundError("llm_call", id);
  }

  fail(
    id: string,
    error: Readonly<Record<string, unknown>>,
    durationMs: number,
    finishedAt: string,
    cancelled = false,
    usage?: NormalizedUsage,
    details?: Readonly<Record<string, unknown>>,
  ): void {
    const changed = this.database.raw
      .prepare(
        `UPDATE llm_calls SET status = ?, error_json = ?, usage_json = ?, duration_ms = ?,
           finished_at = ?, details_json = ? WHERE id = ?`,
      )
      .run(
        cancelled ? "cancelled" : "failed",
        JSON.stringify(error),
        usage ? JSON.stringify(usage) : null,
        durationMs,
        finishedAt,
        details ? JSON.stringify(details) : null,
        id,
      );
    if (changed.changes !== 1)
      throw new PersistenceNotFoundError("llm_call", id);
  }

  interruptOrphaned(now = new Date().toISOString()): number {
    return Number(
      this.database.raw
        .prepare(
          `UPDATE llm_calls SET status = 'interrupted', finished_at = ?
           WHERE status IN ('started', 'streaming')`,
        )
        .run(now).changes,
    );
  }

  listForRun(runId: string): LlmCallReceipt[] {
    const rows = this.database.raw
      .prepare("SELECT * FROM llm_calls WHERE run_id = ? ORDER BY started_at")
      .all(runId) as unknown as LlmCallRow[];
    return rows.map((row) => ({
      id: row.id,
      stepId: row.step_id,
      purpose: row.purpose,
      protocol: row.protocol,
      model: row.model,
      status: row.status,
      finishReason: row.finish_reason,
      usage: row.usage_json
        ? (JSON.parse(row.usage_json) as NormalizedUsage)
        : null,
      error: row.error_json
        ? (JSON.parse(row.error_json) as Record<string, unknown>)
        : null,
      ttftMs: row.ttft_ms,
      durationMs: row.duration_ms,
      details: row.details_json
        ? (JSON.parse(row.details_json) as Record<string, unknown>)
        : null,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    }));
  }
}

export interface LlmCallReceipt {
  id: string;
  stepId: string;
  purpose: string;
  protocol: ModelProtocol;
  model: string;
  status: string;
  finishReason: string | null;
  usage: NormalizedUsage | null;
  error: Record<string, unknown> | null;
  ttftMs: number | null;
  durationMs: number | null;
  details: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string | null;
}

interface LlmCallRow {
  id: string;
  step_id: string;
  purpose: string;
  protocol: ModelProtocol;
  model: string;
  status: string;
  finish_reason: string | null;
  usage_json: string | null;
  error_json: string | null;
  ttft_ms: number | null;
  duration_ms: number | null;
  details_json: string | null;
  started_at: string;
  finished_at: string | null;
}
