import type {
  NarrativeRun,
  NarrativeRunStep,
  RunBudgetUsage,
  RunStepError,
} from "@narrative-lantern/domain";
import {
  SqliteRunRepository,
  type NarrativeDatabase,
} from "@narrative-lantern/persistence";

import type { NarrativeModelClient } from "./model-client.js";
import { throwIfAborted } from "./project-guard.js";

/**
 * Persisted run event type signalling that a run degraded to a fallback
 * capability (e.g. FTS/entity ranking instead of vector retrieval).
 */
export const RUN_DEGRADED_EVENT = "run.degraded";

export interface EmbeddingDegradation {
  capability: "embedding";
  /** Stable machine-readable reason, e.g. "embedding_not_configured". */
  reason: string;
}

export interface OptionalEmbeddingOutcome {
  vectors: number[][];
  model: string | null;
  modelId: string | null;
  usage: RunBudgetUsage;
  warning: { code: string; message: string } | null;
  /**
   * Set when the run had inputs to embed but no embedding capability was
   * available (not configured, or the call failed) and the caller degraded
   * to FTS/entity ranking. Null when embeddings ran or there was nothing
   * to embed.
   */
  degradation: EmbeddingDegradation | null;
}

export async function optionalEmbeddings(
  client: NarrativeModelClient,
  run: NarrativeRun,
  step: NarrativeRunStep,
  purpose: string,
  inputs: readonly string[],
  signal: AbortSignal,
): Promise<OptionalEmbeddingOutcome> {
  throwIfAborted(signal);
  if (inputs.length === 0) return emptyOutcome();
  if (!client.embed) return degradedOutcome("embedding_not_configured");
  // Embedding has no implicit writing-model fallback. Without an explicit
  // assignment retrieval degrades visibly to FTS/entity ranking.
  if (!(client.hasEmbeddingAssignment?.() ?? false))
    return degradedOutcome("embedding_not_configured");
  try {
    const result = await client.embed(run, step, purpose, { inputs }, signal);
    throwIfAborted(signal);
    return {
      vectors: result.vectors,
      model: result.model,
      modelId: result.modelId,
      usage: result.usage,
      warning: null,
      degradation: null,
    };
  } catch (error) {
    throwIfAborted(signal);
    const structured = isRunStepError(error) ? error : null;
    const warning = {
      code: structured?.code ?? "embedding.failed",
      message:
        structured?.message ??
        (error instanceof Error ? error.message : String(error)),
    };
    return {
      ...emptyOutcome(),
      usage: structured?.usage ?? zeroUsage(),
      warning,
      degradation: { capability: "embedding", reason: warning.code },
    };
  }
}

/**
 * Persists a `run.degraded` run event for an embedding degradation, at most
 * once per run and capability — later steps of the same run reuse the first
 * record instead of spamming the event log.
 */
export function recordEmbeddingDegradation(
  database: NarrativeDatabase,
  runId: string,
  stepId: string,
  degradation: EmbeddingDegradation | null,
  now = new Date().toISOString(),
): void {
  if (!degradation) return;
  const existing = database.raw
    .prepare(
      `SELECT COUNT(*) AS count FROM run_events
       WHERE run_id = ? AND type = ?
       AND json_extract(payload_json, '$.capability') = ?`,
    )
    .get(runId, RUN_DEGRADED_EVENT, degradation.capability) as {
    count: number;
  };
  if (existing.count > 0) return;
  new SqliteRunRepository(database).appendRunEvent(
    runId,
    stepId,
    RUN_DEGRADED_EVENT,
    { capability: degradation.capability, reason: degradation.reason },
    now,
  );
}

function isRunStepError(value: unknown): value is RunStepError {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as RunStepError).code === "string" &&
    typeof (value as RunStepError).message === "string"
  );
}

function degradedOutcome(reason: string): OptionalEmbeddingOutcome {
  return {
    ...emptyOutcome(),
    degradation: { capability: "embedding", reason },
  };
}

function emptyOutcome(): OptionalEmbeddingOutcome {
  return {
    vectors: [],
    model: null,
    modelId: null,
    usage: zeroUsage(),
    warning: null,
    degradation: null,
  };
}

function zeroUsage(): RunBudgetUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    calls: 0,
    costUsd: 0,
    wallTimeMs: 0,
  };
}
