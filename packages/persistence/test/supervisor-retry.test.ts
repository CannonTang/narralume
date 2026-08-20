import { createProject, type RunStepError } from "@narrative-lantern/domain";
import { NodeNarrativeDatabase } from "../src/node.js";
import {
  buildChapterRecipe,
  HarnessSupervisor,
} from "@narrative-lantern/harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SqliteProjectRepository, SqliteRunRepository } from "../src/index.js";

const now = "2026-08-10T00:00:00.000Z";
let database: NodeNarrativeDatabase;
let runs: SqliteRunRepository;

beforeEach(() => {
  database = new NodeNarrativeDatabase();
  database.migrate();
  new SqliteProjectRepository(database).insert(
    createProject({ id: "p1", title: "潮汐灯塔", now }),
  );
  runs = new SqliteRunRepository(database);
});

afterEach(() => database.close());

describe("HarnessSupervisor retry ownership", () => {
  it("persists run.step.retry_scheduled before delaying available_at, then runs the step when due", async () => {
    seedRun({ maxRetries: 2, retryBaseDelayMs: 1_000 });
    let clock = new Date(now);
    let calls = 0;
    const execute = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw {
          code: "model.rate_limit",
          message: "429 slow down",
          retryable: true,
        } satisfies RunStepError;
      }
      return { output: { ok: true }, artifactKind: "context" };
    });
    const supervisor = new HarnessSupervisor(
      runs,
      { "context.compile": { execute } },
      { now: () => clock, leaseMs: 30_000 },
    );

    // Attempt 1 fails with a retryable error; the run is requeued immediately.
    await supervisor.processRun("run-1", "worker-a");
    expect(runs.getSnapshot("run-1").steps[0]).toMatchObject({
      status: "failed",
      attempt: 1,
    });

    // The router schedules a retry: event first, then a delayed requeue.
    await supervisor.processRun("run-1", "worker-a");
    const snapshot = runs.getSnapshot("run-1");
    const scheduled = snapshot.events.filter(
      (event) => event.type === "run.step.retry_scheduled",
    );
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]).toMatchObject({
      stepId: "run-1:context",
      payload: {
        stepId: "run-1:context",
        attempt: 1,
        maxAttempts: 2,
        reason: "model.rate_limit",
        category: "rate_limit",
        remainingBudget: 0,
      },
    });
    const waitMs = scheduled[0]!.payload["waitMs"] as number;
    expect(waitMs).toBeGreaterThanOrEqual(800);
    expect(waitMs).toBeLessThanOrEqual(1_200);
    expect(scheduled[0]!.payload["nextAttemptAt"]).toBe(
      new Date(clock.getTime() + waitMs).toISOString(),
    );

    // The job is not leasable until the backoff has elapsed.
    const job = database.raw
      .prepare("SELECT status, available_at FROM run_jobs WHERE run_id = ?")
      .get("run-1") as { status: string; available_at: string };
    expect(job.status).toBe("queued");
    expect(job.available_at).toBe(scheduled[0]!.payload["nextAttemptAt"]);
    expect(runs.leaseNext("worker-b", clock.toISOString(), 30_000)).toBeNull();

    // Once due, the scheduled retry starts the step instead of rescheduling.
    clock = new Date(clock.getTime() + waitMs + 1);
    await supervisor.processRun("run-1", "worker-b");
    const after = runs.getSnapshot("run-1");
    expect(after.steps[0]).toMatchObject({ status: "succeeded", attempt: 2 });
    expect(
      after.events.filter((event) => event.type === "run.step.retry_scheduled"),
    ).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("short-circuits fatal errors with run.fatal_shortcut and never retries", async () => {
    seedRun({ maxRetries: 3, retryBaseDelayMs: 1_000 });
    const execute = vi.fn(async () => {
      throw {
        code: "model.authentication",
        message: "invalid api key",
        retryable: true,
      } satisfies RunStepError;
    });
    const supervisor = new HarnessSupervisor(
      runs,
      { "context.compile": { execute } },
      { now: () => new Date(now), leaseMs: 30_000 },
    );

    await supervisor.processRun("run-1", "worker-a");
    await supervisor.processRun("run-1", "worker-a");

    const snapshot = runs.getSnapshot("run-1");
    expect(snapshot.run.status).toBe("failed");
    const fatal = snapshot.events.filter(
      (event) => event.type === "run.fatal_shortcut",
    );
    expect(fatal).toHaveLength(1);
    expect(fatal[0]).toMatchObject({
      stepId: "run-1:context",
      payload: {
        stepId: "run-1:context",
        category: "authentication",
        message: "invalid api key",
      },
    });
    expect(
      snapshot.events.some(
        (event) => event.type === "run.step.retry_scheduled",
      ),
    ).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);

    // A terminal run routes to wait and the job is finished, not requeued.
    await supervisor.processRun("run-1", "worker-a");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      database.raw
        .prepare("SELECT status FROM run_jobs WHERE run_id = ?")
        .get("run-1"),
    ).toEqual({ status: "finished" });
  });

  it("persists run.step.retry_exhausted when the policy retry budget is spent", async () => {
    seedRun({ maxRetries: 0, retryBaseDelayMs: 1_000 });
    const execute = vi.fn(async () => {
      throw {
        code: "model.server",
        message: "500",
        retryable: true,
      } satisfies RunStepError;
    });
    const supervisor = new HarnessSupervisor(
      runs,
      { "context.compile": { execute } },
      { now: () => new Date(now), leaseMs: 30_000 },
    );

    await supervisor.processRun("run-1", "worker-a");
    await supervisor.processRun("run-1", "worker-a");

    const snapshot = runs.getSnapshot("run-1");
    expect(snapshot.run.status).toBe("failed");
    const exhausted = snapshot.events.filter(
      (event) => event.type === "run.step.retry_exhausted",
    );
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]).toMatchObject({
      stepId: "run-1:context",
      payload: {
        stepId: "run-1:context",
        attempts: 1,
        reason: "attempts_exhausted",
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

function seedRun(policy: Readonly<Record<string, unknown>>) {
  const recipe = buildChapterRecipe("run-1", 0);
  return runs.create({
    id: "run-1",
    projectId: "p1",
    recipe: recipe.name,
    recipeVersion: recipe.version,
    mode: "autopilot",
    targetOutlineNodeId: null,
    policy,
    budgetLimit: {
      maxInputTokens: 100_000,
      maxOutputTokens: 50_000,
      maxCalls: 50,
      maxCostUsd: null,
      maxWallTimeMs: 3_600_000,
    },
    steps: recipe.steps,
    now,
  });
}
