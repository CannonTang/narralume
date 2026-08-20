import type { RunStepError } from "@narrative-lantern/domain";

import { DEADLINE_EXCEEDED_CODE } from "./deadline.js";

/** First-class run event types emitted by the harness retry owner. */
export const RETRY_SCHEDULED_EVENT = "run.step.retry_scheduled";
export const RETRY_EXHAUSTED_EVENT = "run.step.retry_exhausted";
export const FATAL_SHORTCUT_EVENT = "run.fatal_shortcut";

export const DEFAULT_MAX_RETRIES = 4;
export const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
export const MAX_RETRY_DELAY_MS = 30_000;

/**
 * Fatal categories never consume a retry: the run fails immediately.
 * Mirrors the fatal ModelErrorCategory values from @narrative-lantern/llm
 * (harness deliberately does not depend on the llm package).
 */
const FATAL_CATEGORIES = new Set([
  "authentication",
  "permission",
  "invalid_request",
  "context_length",
  "content_filter",
  "model_not_found",
]);

/** Retryable categories: transient transport/server/timeout failures. */
const RETRYABLE_CATEGORIES = new Set([
  "rate_limit",
  "server",
  "network",
  "timeout",
  "request_start_timeout",
  "stream_idle_timeout",
  "stream_interrupted",
]);

const CANCELLED_CATEGORIES = new Set(["cancelled"]);

/** Bare error codes that double as category names (e.g. legacy "network"). */
const KNOWN_BARE_CATEGORIES = new Set([
  ...FATAL_CATEGORIES,
  ...RETRYABLE_CATEGORIES,
  ...CANCELLED_CATEGORIES,
  "protocol",
]);

export type StepErrorClass = "fatal" | "retryable" | "cancelled" | "unknown";

export interface StepErrorClassification {
  kind: StepErrorClass;
  category: string | null;
}

/**
 * Classifies a failed step's error for the harness retry owner.
 * Categories come from the `model.<category>` code convention used by the
 * narrative model client, from bare category codes, or from
 * `error.details.category`. Unknown errors keep the legacy semantics: the
 * caller falls back to the error's `retryable` flag.
 */
export function classifyStepError(
  error: RunStepError | null | undefined,
): StepErrorClassification {
  if (!error) return { kind: "unknown", category: null };
  if (error.code === "worker.cancelled") {
    return { kind: "cancelled", category: "cancelled" };
  }
  // An expired deadline is a hard stop: it must never auto-retry, so it
  // short-circuits the run like any other fatal classification.
  if (error.code === DEADLINE_EXCEEDED_CODE) {
    return { kind: "fatal", category: DEADLINE_EXCEEDED_CODE };
  }
  const category = extractCategory(error);
  if (category === null) return { kind: "unknown", category: null };
  if (CANCELLED_CATEGORIES.has(category))
    return { kind: "cancelled", category };
  if (FATAL_CATEGORIES.has(category)) return { kind: "fatal", category };
  if (RETRYABLE_CATEGORIES.has(category)) {
    return { kind: "retryable", category };
  }
  return { kind: "unknown", category };
}

function extractCategory(error: RunStepError): string | null {
  const stripped = error.code.startsWith("model.")
    ? error.code.slice("model.".length)
    : error.code;
  if (KNOWN_BARE_CATEGORIES.has(stripped)) return stripped;
  const details = error.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const category = (details as Record<string, unknown>)["category"];
    if (typeof category === "string") return category;
  }
  return null;
}

/** Retry-relevant slice of the run's effective policy. */
export interface HarnessRetryPolicy {
  maxRetries: number;
  retryBaseDelayMs: number;
  runDeadlineMs: number | null;
}

/**
 * Reads the retry policy out of the persisted run.policy record. Runs created
 * before policy resolution (or with out-of-range values) fall back to the
 * built-in defaults.
 */
export function resolveHarnessRetryPolicy(
  policy: Readonly<Record<string, unknown>>,
): HarnessRetryPolicy {
  return {
    maxRetries: intBetween(policy["maxRetries"], 0, 5) ?? DEFAULT_MAX_RETRIES,
    retryBaseDelayMs:
      intBetween(policy["retryBaseDelayMs"], 1, 60_000) ??
      DEFAULT_RETRY_BASE_DELAY_MS,
    runDeadlineMs: intBetween(policy["runDeadlineMs"], 1, 86_400_000),
  };
}

function intBetween(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

/**
 * Exponential backoff with ±20% jitter, capped at MAX_RETRY_DELAY_MS.
 * `attempt` is the number of attempts already consumed (>= 1), so the first
 * retry waits roughly `baseDelayMs`.
 */
export function computeRetryBackoffMs(
  attempt: number,
  baseDelayMs: number,
  random: () => number = Math.random,
): number {
  const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const jitter = 0.8 + random() * 0.4;
  return Math.min(MAX_RETRY_DELAY_MS, Math.round(exponential * jitter));
}
