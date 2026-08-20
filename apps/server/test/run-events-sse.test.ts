import http from "node:http";

import type { NarrativeModelClient } from "@narrative-lantern/narrative";
import { NodeNarrativeDatabase } from "@narrative-lantern/persistence/node";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { ServerConfig } from "../src/config.js";

const config: ServerConfig = {
  dataDirectory: ".",
  databasePath: ":memory:",
  host: "127.0.0.1",
  port: 4317,
  environment: "test",
};

const resources: {
  app: Awaited<ReturnType<typeof buildApp>>;
  database: NodeNarrativeDatabase;
}[] = [];

afterEach(async () => {
  while (resources.length) {
    const resource = resources.pop();
    await resource?.app.close();
    resource?.database.close();
  }
});

async function setup() {
  const database = new NodeNarrativeDatabase();
  const environment = {
    NARRATIVE_LLM_API_KEY: "server-only-test-key",
    NARRATIVE_LLM_BASE_URL: "https://api.example.com/v1",
    NARRATIVE_LLM_MODEL: "test-model",
    NARRATIVE_LLM_CONTEXT_WINDOW: "128000",
    NARRATIVE_LLM_MAX_OUTPUT_TOKENS: "32000",
  };
  const app = await buildApp({
    config,
    database,
    environment,
    narrativeModelClient: flakyModel(),
    enableRunWorker: false,
    logger: false,
  });
  resources.push({ app, database });
  return { app, database };
}

async function createProjectAndChapter(
  app: Awaited<ReturnType<typeof buildApp>>,
) {
  const projectResponse = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      requestId: globalThis.crypto.randomUUID(),
      title: "潮汐灯塔",
      premise: "灯灭时港口遗忘一个人。",
    },
  });
  const project = projectResponse.json() as { id: string };
  const bible = (
    await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/story-bible`,
    })
  ).json() as { outline: { id: string }[] };
  const chapterResponse = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/outline`,
    payload: {
      parentId: bible.outline[0]!.id,
      kind: "chapter",
      ordinal: 0,
      title: "雾港失灯",
      summary: "林昼回港当夜灯塔熄灭。",
      goal: "发现遗忘规则",
      conflict: "父亲否认失踪者存在",
      metadata: {},
    },
  });
  expect(chapterResponse.statusCode).toBe(201);
  return {
    projectId: project.id,
    chapterId: (chapterResponse.json() as { id: string }).id,
  };
}

/** Opens the SSE stream against a real listener and collects raw chunks. */
async function openEventStream(app: Awaited<ReturnType<typeof buildApp>>) {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  let buffer = "";
  const request = http.get(`http://127.0.0.1:${port}/api/events`, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      buffer += chunk;
    });
  });
  await new Promise<void>((resolve) =>
    request.once("response", () => resolve()),
  );
  return {
    request,
    buffer: () => buffer,
    /** Polls briefly until the predicate matches the accumulated stream. */
    async waitFor(
      predicate: (buffer: string) => boolean,
      timeoutMs = 5_000,
    ): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate(buffer)) return buffer;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return buffer;
    },
  };
}

describe("run_events SSE push", () => {
  it("broadcasts persisted run events (retry_scheduled) over /api/events", async () => {
    const { app, database } = await setup();
    const stream = await openEventStream(app);
    try {
      // The handshake still arrives first; heartbeat wiring is untouched.
      await stream.waitFor((buffer) => buffer.includes("event: connected"));

      const target = await createProjectAndChapter(app);
      const created = await app.inject({
        method: "POST",
        url: `/api/projects/${target.projectId}/runs/chapter`,
        payload: {
          requestId: "sse-heartbeat",
          targetOutlineNodeId: target.chapterId,
        },
      });
      expect(created.statusCode, created.body).toBe(202);
      const runId = (created.json() as { run: { id: string } }).run.id;

      // context.compile succeeds; scene.plan fails once with a retryable
      // model error; the next advance makes the harness persist and
      // broadcast run.step.retry_scheduled.
      for (let index = 0; index < 3; index += 1) {
        const advanced = await app.inject({
          method: "POST",
          url: `/api/runs/${runId}/advance`,
          payload: { projectId: target.projectId },
        });
        expect(advanced.statusCode, advanced.body).toBe(200);
      }

      const received = await stream.waitFor((buffer) =>
        buffer.includes('"eventType":"run.step.retry_scheduled"'),
      );
      const frames = received
        .split("\n\n")
        .filter((block) => block.startsWith("event: run.event"))
        .map((block) => {
          const data = block
            .split("\n")
            .find((line) => line.startsWith("data: "));
          return JSON.parse(data!.slice("data: ".length)) as {
            type: string;
            runId: string;
            stepId: string | null;
            sequence: number;
            eventType: string;
            payload: Record<string, unknown>;
          };
        })
        .filter((event) => event.runId === runId);
      const retry = frames.find(
        (event) => event.eventType === "run.step.retry_scheduled",
      );
      expect(retry).toBeDefined();
      expect(retry!.payload).toMatchObject({
        attempt: 1,
        reason: "model.server",
        category: "server",
      });
      expect(typeof retry!.sequence).toBe("number");
      // The persisted stream and the SSE stream agree on the failure event.
      expect(frames.some((event) => event.eventType === "step.failed")).toBe(
        true,
      );

      const persisted = database.raw
        .prepare(
          "SELECT type FROM run_events WHERE run_id = ? ORDER BY sequence",
        )
        .all(runId) as unknown as { type: string }[];
      expect(persisted.map((event) => event.type)).toContain(
        "run.step.retry_scheduled",
      );
    } finally {
      stream.request.destroy();
    }
  });

  it("broadcasts events persisted by other repository instances (worker/model-client path)", async () => {
    const { app, database } = await setup();
    const stream = await openEventStream(app);
    try {
      await stream.waitFor((buffer) => buffer.includes("event: connected"));

      const target = await createProjectAndChapter(app);
      const created = await app.inject({
        method: "POST",
        url: `/api/projects/${target.projectId}/runs/chapter`,
        payload: {
          requestId: "sse-reconnect",
          targetOutlineNodeId: target.chapterId,
        },
      });
      expect(created.statusCode, created.body).toBe(202);
      const runId = (created.json() as { run: { id: string } }).run.id;

      // Workers and the model client persist through their own repository
      // instances (e.g. run.degraded, run.llm.repair_attempt). A fresh
      // instance here simulates that path: the database-level broadcast must
      // still push it over SSE.
      const { SqliteRunRepository } =
        await import("@narrative-lantern/persistence");
      new SqliteRunRepository(database).appendRunEvent(
        runId,
        null,
        "run.degraded",
        { capability: "embedding", reason: "embedding_not_configured" },
        new Date().toISOString(),
      );

      const received = await stream.waitFor((buffer) =>
        buffer.includes('"eventType":"run.degraded"'),
      );
      expect(received).toContain('"runId":"' + runId + '"');
      expect(received).toContain("embedding_not_configured");
    } finally {
      stream.request.destroy();
    }
  });
});

/** scene.plan fails once with a retryable error, then validates normally. */
function flakyModel(): NarrativeModelClient {
  const usage = {
    inputTokens: 10,
    outputTokens: 10,
    calls: 1,
    costUsd: 0,
    wallTimeMs: 5,
  };
  let scenePlanFailures = 0;
  return {
    async text() {
      return { text: "雾从海面推上石阶，灯塔在远处沉默。", usage };
    },
    async structured(_run, _step, purpose, _request, _contract, validate) {
      if (purpose === "scene-plan" && scenePlanFailures === 0) {
        scenePlanFailures += 1;
        throw {
          code: "model.server",
          message: "上游服务 500",
          retryable: true,
        };
      }
      const checked = validate({
        chapterGoal: "发现遗忘规则",
        povEntityId: null,
        scenes: [
          {
            title: "熄灯",
            goal: "进入灯塔",
            conflict: "父亲阻拦",
            turn: "灯塔熄灭",
            outcome: "发现空椅子",
            locationId: null,
            participants: [],
            targetCharacters: 1200,
          },
        ],
        continuityRisks: [],
      });
      if (!checked.success) throw new Error(checked.issues.join("; "));
      return { value: checked.data, usage, mode: "native", attempts: 1 };
    },
  } as NarrativeModelClient;
}
