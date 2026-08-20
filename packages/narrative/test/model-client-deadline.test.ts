import { createProject } from "@narrative-lantern/domain";
import {
  buildChapterRecipe,
  HarnessSupervisor,
  type StepWorker,
} from "@narrative-lantern/harness";
import type * as llm from "@narrative-lantern/llm";
import type { AdapterConfig } from "@narrative-lantern/llm";
import {
  SqliteAssignmentRepository,
  SqliteModelRepository,
  SqliteProjectRepository,
  SqliteProviderRepository,
  SqliteRunRepository,
} from "@narrative-lantern/persistence";
import { NodeNarrativeDatabase } from "@narrative-lantern/persistence/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayNarrativeModelClient } from "../src/model-client.js";

const captured = vi.hoisted(() => ({ adapterConfigs: [] as AdapterConfig[] }));

vi.mock("@narrative-lantern/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof llm>();
  return {
    ...actual,
    createModelAdapter: (config: AdapterConfig) => {
      captured.adapterConfigs.push(config);
      return actual.createModelAdapter(config);
    },
  };
});

const NOW = "2026-08-10T00:00:00.000Z";

beforeEach(() => {
  captured.adapterConfigs.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function seedWritingAssignment(database: NodeNarrativeDatabase): void {
  new SqliteProviderRepository(database).upsert({
    id: "provider-a",
    name: "provider-a",
    wireApi: "openai-chat",
    baseUrl: "https://provider-a.example/v1",
    endpoint: null,
    credentialRef: "raw-secret-key-123456",
    anthropicVersion: null,
    headers: {},
    queryParams: {},
    requestStartTimeoutMs: null,
    streamIdleTimeoutMs: null,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
  });
  new SqliteModelRepository(database).upsert({
    id: "model-a",
    providerId: "provider-a",
    modelId: "assigned-model",
    taskType: "writing",
    contextWindow: 128_000,
    maxOutputTokens: 32_000,
    sampling: {},
    // These tests exercise the full structured tier chain and its logical
    // deadline/cancellation propagation, so the capability probe is explicit.
    capabilities: {
      structuredOutput: true,
      structuredOutputNative: true,
      structuredOutputJsonMode: true,
    },
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
  });
  new SqliteAssignmentRepository(database).set("writing", "model-a", NOW);
}

/** Creates a queued run; leasing/starting steps is left to the supervisor. */
function createQueuedRun(
  database: NodeNarrativeDatabase,
  options: {
    runId: string;
    projectId: string;
    policy: Record<string, unknown>;
  },
): SqliteRunRepository {
  new SqliteProjectRepository(database).insert(
    createProject({ id: options.projectId, title: "远潮", now: NOW }),
  );
  const recipe = buildChapterRecipe(options.runId, 0);
  const runs = new SqliteRunRepository(database);
  runs.create({
    id: options.runId,
    projectId: options.projectId,
    recipe: recipe.name,
    recipeVersion: recipe.version,
    mode: "manual",
    targetOutlineNodeId: null,
    policy: options.policy,
    budgetLimit: {
      maxInputTokens: 10_000,
      maxOutputTokens: 10_000,
      maxCalls: 10,
      maxCostUsd: null,
      maxWallTimeMs: 60_000,
    },
    steps: recipe.steps,
    now: NOW,
  });
  return runs;
}

function chatResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-1",
      choices: [{ message: { content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("adapter config deadline clamping", () => {
  it("uses provider request/idle timeouts when the run did not explicitly override them", async () => {
    const database = new NodeNarrativeDatabase();
    database.migrate();
    seedWritingAssignment(database);
    const providers = new SqliteProviderRepository(database);
    providers.upsert({
      ...providers.get("provider-a")!,
      requestStartTimeoutMs: 90_000,
      streamIdleTimeoutMs: 240_000,
      updatedAt: NOW,
    });
    const runs = createQueuedRun(database, {
      runId: "run-provider-timeout",
      projectId: "project-provider-timeout",
      policy: {
        logicalCallDeadlineMs: 300_000,
        explicitPolicyFields: [],
        maxRetries: 0,
      },
    });
    runs.leaseNext("worker", NOW, 30_000);
    const step = runs.startStep(
      "run-provider-timeout",
      "run-provider-timeout:context",
      NOW,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => chatResponse("ok")),
    );

    await new GatewayNarrativeModelClient(database, {}).text(
      runs.getRun("run-provider-timeout")!,
      step,
      "draft-generation",
      { messages: [{ role: "user", content: "继续" }] },
      new AbortController().signal,
    );

    expect(captured.adapterConfigs[0]).toMatchObject({
      requestStartTimeoutMs: 90_000,
      streamIdleTimeoutMs: 240_000,
      timeoutMs: 300_000,
    });
    const applied = JSON.parse(
      (
        database.raw
          .prepare(
            "SELECT applied_json FROM model_assignment_snapshots WHERE run_id = ?",
          )
          .get("run-provider-timeout") as { applied_json: string }
      ).applied_json,
    ) as Record<string, unknown>;
    expect(applied).toMatchObject({
      timeoutPolicy: {
        requestStartTimeoutMs: { value: 90_000, source: "provider" },
        streamIdleTimeoutMs: { value: 240_000, source: "provider" },
      },
    });
    database.close();
  });

  it("clamps the per-attempt timeout to the logical call deadline", async () => {
    const database = new NodeNarrativeDatabase();
    database.migrate();
    seedWritingAssignment(database);
    const runs = createQueuedRun(database, {
      runId: "run-clamp",
      projectId: "project-clamp",
      policy: {
        requestStartTimeoutMs: 600_000,
        logicalCallDeadlineMs: 30_000,
        explicitPolicyFields: ["requestStartTimeoutMs"],
        maxRetries: 0,
      },
    });
    runs.leaseNext("worker", NOW, 30_000);
    const step = runs.startStep("run-clamp", "run-clamp:context", NOW);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: "boom" } }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );

    await expect(
      new GatewayNarrativeModelClient(database, {}).text(
        runs.getRun("run-clamp")!,
        step,
        "draft-generation",
        { messages: [{ role: "user", content: "继续" }] },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "model.server" });

    // request-start remains independent; only logical-call bounds the whole attempt.
    expect(captured.adapterConfigs).toHaveLength(1);
    expect(captured.adapterConfigs[0]).toMatchObject({
      timeoutMs: 30_000,
      requestStartTimeoutMs: 600_000,
      logicalCallDeadlineMs: 30_000,
    });
    database.close();
  });

  it("keeps the per-attempt timeout when it is below the logical deadline", async () => {
    const database = new NodeNarrativeDatabase();
    database.migrate();
    seedWritingAssignment(database);
    const runs = createQueuedRun(database, {
      runId: "run-noclamp",
      projectId: "project-noclamp",
      policy: {
        requestStartTimeoutMs: 45_000,
        logicalCallDeadlineMs: 300_000,
        explicitPolicyFields: ["requestStartTimeoutMs"],
        maxRetries: 0,
      },
    });
    runs.leaseNext("worker", NOW, 30_000);
    const step = runs.startStep("run-noclamp", "run-noclamp:context", NOW);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.resolve(chatResponse("ok"))),
    );

    await new GatewayNarrativeModelClient(database, {}).text(
      runs.getRun("run-noclamp")!,
      step,
      "draft-generation",
      { messages: [{ role: "user", content: "继续" }] },
      new AbortController().signal,
    );

    expect(captured.adapterConfigs[0]).toMatchObject({
      timeoutMs: 300_000,
      requestStartTimeoutMs: 45_000,
    });
    database.close();
  });
});

describe("structured repair signal propagation", () => {
  it("uses one logical deadline across structured tiers", async () => {
    const database = new NodeNarrativeDatabase();
    database.migrate();
    seedWritingAssignment(database);
    const runs = createQueuedRun(database, {
      runId: "run-structured-deadline",
      projectId: "project-structured-deadline",
      policy: {
        logicalCallDeadlineMs: 100,
        maxRetries: 0,
        maxRepairAttempts: 0,
      },
    });
    runs.leaseNext("worker", NOW, 30_000);
    const step = runs.startStep(
      "run-structured-deadline",
      "run-structured-deadline:context",
      NOW,
    );
    let physicalCalls = 0;
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn((_input: string | URL | Request, init?: RequestInit) => {
          physicalCalls += 1;
          return new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(
              () => resolve(chatResponse("not json")),
              60,
            );
            init?.signal?.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(init.signal?.reason as unknown);
              },
              { once: true },
            );
          });
        }),
      );
      const operation = new GatewayNarrativeModelClient(
        database,
        {},
      ).structured(
        runs.getRun("run-structured-deadline")!,
        step,
        "scene-plan",
        { messages: [{ role: "user", content: "计划" }] },
        { name: "scene", schema: { type: "object" } },
        () => ({ success: false as const, issues: ["invalid"] }),
        new AbortController().signal,
      );
      const rejected = expect(operation).rejects.toMatchObject({
        code: "model.logical_call_timeout",
        retryable: true,
        details: { scope: "logical-call", deadlineMs: 100 },
      });

      await vi.advanceTimersByTimeAsync(60);
      expect(physicalCalls).toBe(2);
      await vi.advanceTimersByTimeAsync(40);
      await rejected;
      const receipt = database.raw
        .prepare("SELECT status, error_json FROM llm_calls WHERE run_id = ?")
        .get("run-structured-deadline") as {
        status: string;
        error_json: string;
      };
      expect(receipt.status).toBe("failed");
      expect(JSON.parse(receipt.error_json)).toMatchObject({
        code: "model.logical_call_timeout",
        details: { scope: "logical-call", deadlineMs: 100 },
      });
    } finally {
      vi.useRealTimers();
      database.close();
    }
  });

  it("passes the caller signal to every round, including repair rounds", async () => {
    const database = new NodeNarrativeDatabase();
    database.migrate();
    seedWritingAssignment(database);
    const runs = createQueuedRun(database, {
      runId: "run-repair",
      projectId: "project-repair",
      policy: { maxRetries: 0, maxRepairAttempts: 1 },
    });
    runs.leaseNext("worker", NOW, 30_000);
    const step = runs.startStep("run-repair", "run-repair:context", NOW);
    const signals: Array<AbortSignal | undefined> = [];
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        signals.push(init?.signal ?? undefined);
        // The repair round is the 4th physical call (native, json-mode,
        // prompt, repair); aborting then must abort its fetch signal too.
        if (signals.length === 4) controller.abort();
        return Promise.resolve(chatResponse("not json at all"));
      }),
    );
    const contract = { name: "scene", schema: { type: "object" } };
    const validate = () => ({ success: false as const, issues: ["invalid"] });

    await expect(
      new GatewayNarrativeModelClient(database, {}).structured(
        runs.getRun("run-repair")!,
        step,
        "scene-plan",
        { messages: [{ role: "user", content: "计划" }] },
        contract,
        validate,
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "model.cancelled" });

    expect(signals).toHaveLength(4);
    for (const signal of signals) expect(signal?.aborted).toBe(true);
    database.close();
  });
});

describe("cancel during streaming", () => {
  it("aborts fetch immediately, keeps the partial output, and never retries", async () => {
    const database = new NodeNarrativeDatabase();
    database.migrate();
    seedWritingAssignment(database);
    const runs = createQueuedRun(database, {
      runId: "run-cancel",
      projectId: "project-cancel",
      policy: { maxRetries: 0 },
    });

    const fetchSignals: Array<AbortSignal | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        fetchSignals.push(init?.signal ?? undefined);
        // A streaming SSE response that emits one delta and then stays open
        // until the request is aborted, like a real provider connection.
        const stream = new ReadableStream<Uint8Array>({
          start(streamController) {
            streamController.enqueue(
              new TextEncoder().encode(
                'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"前半段"}}]}\n\n',
              ),
            );
            init?.signal?.addEventListener(
              "abort",
              () =>
                streamController.error(
                  new DOMException("The operation was aborted", "AbortError"),
                ),
              { once: true },
            );
          },
        });
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }),
    );

    let firstDelta!: () => void;
    const firstDeltaSeen = new Promise<void>((resolve) => {
      firstDelta = resolve;
    });
    const client = new GatewayNarrativeModelClient(
      database,
      {},
      (_runId, _stepId, event) => {
        if (event.type === "text.delta") firstDelta();
      },
    );
    const worker: StepWorker = {
      async execute(snapshot, step, signal) {
        const result = await client.text(
          snapshot.run,
          step,
          "draft-generation",
          { messages: [{ role: "user", content: "继续" }] },
          signal,
        );
        return {
          output: { text: result.text },
          artifactKind: "chapter.draft",
          usage: result.usage,
        };
      },
    };
    const supervisor = new HarnessSupervisor(runs, {
      "context.compile": worker,
    });

    const processed = supervisor.processRun("run-cancel", "worker-1");
    await firstDeltaSeen;
    // Mirror the server cancel route: set the flag, then interrupt.
    runs.requestCancel("run-cancel", new Date().toISOString());
    supervisor.interrupt("run-cancel");
    await processed;

    // The in-flight fetch was aborted by the interrupt.
    expect(fetchSignals).toHaveLength(1);
    expect(fetchSignals[0]?.aborted).toBe(true);

    // The step failed as cancelled with the partial output preserved.
    const stepRow = database.raw
      .prepare(
        "SELECT status, error_json FROM run_steps WHERE run_id = ? AND ordinal = 0",
      )
      .get("run-cancel") as { status: string; error_json: string };
    expect(stepRow.status).toBe("failed");
    const stepError = JSON.parse(stepRow.error_json) as Record<string, unknown>;
    expect(stepError).toMatchObject({
      code: "model.cancelled",
      details: { partialText: "前半段" },
    });

    // The call receipt is marked cancelled, not failed.
    expect(
      database.raw
        .prepare("SELECT status FROM llm_calls WHERE run_id = ?")
        .all("run-cancel"),
    ).toEqual([{ status: "cancelled" }]);

    // The next routing cancels the run; no retry was ever scheduled.
    await supervisor.processRun("run-cancel", "worker-1");
    expect(runs.getRun("run-cancel")!.status).toBe("cancelled");
    const eventTypes = (
      database.raw
        .prepare("SELECT type FROM run_events WHERE run_id = ?")
        .all("run-cancel") as Array<{ type: string }>
    ).map((row) => row.type);
    expect(eventTypes).toContain("run.cancelled");
    expect(eventTypes).not.toContain("run.step.retry_scheduled");
    database.close();
  });
});
