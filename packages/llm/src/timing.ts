import type { ModelCallTiming } from "./types.js";

/** Starts the timing record for one physical attempt at dispatch time. */
export function createTiming(dispatchedAt = Date.now()): ModelCallTiming {
  return { dispatchedAt };
}

/** Records response-header arrival and the dispatch→headers segment. */
export function markHeadersArrived(
  timing: ModelCallTiming,
  at = Date.now(),
): void {
  timing.headersAt ??= at;
  timing.timeToHeadersMs ??= at - timing.dispatchedAt;
}

/**
 * Records a streamed event (or the full body for non-streaming calls). The
 * first call fixes `firstEventAt`/`timeToFirstTokenMs`; every call refreshes
 * `lastEventAt`.
 */
export function markTimingEvent(
  timing: ModelCallTiming,
  at = Date.now(),
): void {
  if (timing.firstEventAt === undefined) {
    timing.firstEventAt = at;
    timing.timeToFirstTokenMs = at - timing.dispatchedAt;
  }
  timing.lastEventAt = at;
}

/**
 * Seals the timing record at success or failure and derives the remaining
 * durations. Idempotent: the first finalization wins.
 */
export function finalizeTiming(
  timing: ModelCallTiming,
  at = Date.now(),
): ModelCallTiming {
  timing.finishedAt ??= at;
  timing.totalDurationMs ??= timing.finishedAt - timing.dispatchedAt;
  if (
    timing.firstEventAt !== undefined &&
    timing.lastEventAt !== undefined &&
    timing.streamActiveMs === undefined
  ) {
    timing.streamActiveMs = timing.lastEventAt - timing.firstEventAt;
  }
  return timing;
}
