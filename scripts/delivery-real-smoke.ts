import { resolve } from "node:path";

import type { FastifyInstance } from "fastify";
import { config as loadDotEnv } from "dotenv";

import { buildApp } from "../apps/server/src/app.js";
import type { ServerConfig } from "../apps/server/src/config.js";
import { SqliteLlmCallRepository } from "@narrative-lantern/persistence";
import { NodeNarrativeDatabase } from "@narrative-lantern/persistence/node";

import {
  configureSmokeModelTarget,
  createSmokeWorkspace,
  currentGitCommit,
  finalizeSmokeWorkspace,
  installSignalFlush,
  interruptOrphanedWork,
  originOf,
  parseRealSmokeArgs,
  RunWatcher,
  RunStateTracker,
  SmokeLogger,
  writeSmokeSummary,
  type SmokeCheck,
} from "./real-smoke-harness.js";

loadDotEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const scenario = "delivery-real";
const args = parseRealSmokeArgs(process.argv.slice(2), {
  script: "delivery-real-smoke.ts",
  defaultProtocols: ["openai-responses"],
  singleProtocol: true,
});
const protocol = args.protocols[0]!;
const modelIds: Record<string, string> = {
  "openai-chat": "environment-chat",
  "openai-responses": "environment-responses",
  "anthropic-messages": "environment-anthropic",
};
const modelId = modelIds[protocol];
if (!modelId) throw new Error(`Unsupported protocol: ${protocol}`);

const workspace = createSmokeWorkspace(scenario, { outputDir: args.outputDir });
const logger = new SmokeLogger(workspace.jsonlPath, scenario, {
  diagnostic: args.diagnostic,
});
installSignalFlush(logger);
const startedAt = new Date().toISOString();
const checks: SmokeCheck[] = [];
let success = false;

const config: ServerConfig = {
  dataDirectory: ".",
  databasePath: workspace.dbPath,
  host: "127.0.0.1",
  port: 4317,
  environment: "test",
};
const database = new NodeNarrativeDatabase(workspace.dbPath);
database.migrate();
interruptOrphanedWork(logger, database);
const tracker = new RunStateTracker(logger, database, {
  diagnostic: args.diagnostic,
});
const watcher = new RunWatcher(tracker);
watcher.startPolling();
const app = await buildApp({
  config,
  database,
  environment: process.env,
  logger: false,
  enableRunWorker: false,
});
const wallStart = Date.now();

logger.event("scenario.start", {
  protocols: args.protocols,
  workspace: workspace.dir,
  gitCommit: currentGitCommit(),
});

function recordCheck(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  logger.event("scenario.check", { name, ok, ...(detail ? { detail } : {}) });
}

try {
  const target = configureSmokeModelTarget(database, modelId);
  if (!target) {
    throw new Error(`${protocol} model limits/credential are not configured`);
  }
  process.stdout.write(`model ${protocol}: configured\n`);
  logger.event("model.resolved", {
    modelId,
    protocol,
    model: target.model.modelId,
    baseUrlOrigin: originOf(target.provider.baseUrl),
  });

  const project = await jsonRequest<{ id: string }>(
    app,
    "POST",
    "/api/projects",
    {
      requestId: globalThis.crypto.randomUUID(),
      title: "盐雾档案",
      premise: "修复师从受热显字的旧信中追查一座港口被共同遗忘的人。",
    },
    [201],
  );
  const source = [
    "# 第一章 退潮后的信",
    "沈砚在旧邮局地板上发现一封覆着盐粒的空白信。信封没有邮戳，胶痕却是新鲜的。她先把纸张湿度记在账本上，再把一小碟海盐放到煤油灯旁作对照。",
    "灯焰靠近时，碟里的盐没有变化，信纸里的盐粒却沿着看不见的笔画析出。收件人的姓先浮出来：沈。与此同时，她忘了姐姐写字时总会压低哪一侧手腕。",
    "",
    "# 第二章 无名地址",
    "邮局墙上的投递图没有街名，只有潮位刻度。沈砚按空白信显出的顺序对照刻度，发现地址指向每天只露出四十七分钟的旧防波堤。",
    "她去找退休邮差陆鹤。老人承认见过这种信，却坚持港口从来没有姓沈的第二个女儿。沈砚没有争辩，只把账本推过去：昨夜的记录中有一行墨迹，笔压和她完全不同。",
    "",
    "# 第三章 四十七分钟",
    "退潮开始后，防波堤下露出一排封死的铜制信箱。每个箱门内侧都刻着一个被港口遗忘的名字。沈砚找到与自己同姓的那一格，却没有立即投信。",
    "她先用一张无关的废纸测试。纸进入投递口后，陆鹤忘了刚才说过的一句话。规则因此完整起来：邮局可以把信送往记忆消失之前，但会从寄信人身边取走一段等价的见证。",
  ].join("\n\n");
  const preview = await jsonRequest<ImportDetail>(
    app,
    "POST",
    "/api/imports/preview",
    {
      targetProjectId: project.id,
      filename: "盐雾旧稿.md",
      format: "markdown",
      contentBase64: Buffer.from(source).toString("base64"),
    },
    [201],
  );
  process.stdout.write(
    `preview: ${preview.candidates.length} candidates, ${preview.batch.sourceCharacters} chars\n`,
  );

  const analysis = await jsonRequest<{ run: { id: string } }>(
    app,
    "POST",
    `/api/imports/${preview.batch.id}/analyze`,
    {
      policy: {
        requestStartTimeoutMs: 120_000,
        maxRetries: 2,
        maxRepairAttempts: 2,
        contextWindow: 64_000,
      },
    },
    [202],
  );
  logger.event("run.created", {
    runId: analysis.run.id,
    projectId: project.id,
    kind: "import-analysis",
  });
  watcher.track(analysis.run.id);
  await finishRun(app, analysis.run.id, project.id);
  recordCheck("import analysis completed", true);
  const ready = await jsonRequest<ImportDetail>(
    app,
    "GET",
    `/api/imports/${preview.batch.id}`,
    undefined,
    [200],
  );
  if (ready.batch.status !== "ready") {
    throw new Error(`analysis did not stage candidates: ${ready.batch.status}`);
  }
  const kinds = new Set(ready.candidates.map((candidate) => candidate.kind));
  for (const requiredKind of [
    "document",
    "intent",
    "entity",
    "style",
    "skill",
  ]) {
    if (!kinds.has(requiredKind)) {
      throw new Error(
        `analysis omitted required candidate kind: ${requiredKind}`,
      );
    }
  }
  process.stdout.write(
    `analysis: ${ready.candidates.length} candidates across ${kinds.size} kinds\n`,
  );
  recordCheck("candidate kinds staged", true, [...kinds].join(","));

  await jsonRequest(
    app,
    "POST",
    `/api/imports/${preview.batch.id}/actions`,
    {
      action: "apply",
      selectedCandidateIds: ready.candidates.map((candidate) => candidate.id),
    },
    [200],
  );
  const quality = await jsonRequest<{
    score: number;
    metrics: Record<string, number>;
  }>(app, "GET", `/api/projects/${project.id}/quality`, undefined, [200]);
  if ((quality.metrics.chapters ?? 0) !== 3) {
    throw new Error(
      `expected three imported chapters, got ${quality.metrics.chapters}`,
    );
  }
  recordCheck("three chapters imported", true);

  const exportSizes: Record<string, number> = {};
  for (const format of ["markdown", "text", "epub", "narrative-bundle"]) {
    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/exports/${format}`,
    });
    if (response.statusCode !== 200 || response.rawPayload.length === 0) {
      throw new Error(`export ${format} failed with ${response.statusCode}`);
    }
    if (
      format === "epub" &&
      response.rawPayload.subarray(0, 2).toString() !== "PK"
    ) {
      throw new Error("EPUB export is not a ZIP container");
    }
    exportSizes[format] = response.rawPayload.length;
  }
  recordCheck(
    "exports generated",
    true,
    Object.entries(exportSizes)
      .map(([key, value]) => `${key}:${value}`)
      .join(","),
  );

  const backup = await jsonRequest<{ id: string }>(
    app,
    "POST",
    `/api/projects/${project.id}/backups`,
    { label: "真实拆书烟测" },
    [201],
  );
  const restored = await jsonRequest<{ projectId: string }>(
    app,
    "POST",
    `/api/backups/${backup.id}/restore`,
    {},
    [201],
  );
  if (restored.projectId === project.id) {
    throw new Error("backup restore reused the original project id");
  }
  const restoredQuality = await jsonRequest<{
    metrics: Record<string, number>;
  }>(
    app,
    "GET",
    `/api/projects/${restored.projectId}/quality`,
    undefined,
    [200],
  );
  if (
    restoredQuality.metrics.manuscriptCharacters !==
    quality.metrics.manuscriptCharacters
  ) {
    throw new Error("restored manuscript character count differs from source");
  }
  recordCheck("backup restore round-trip", true);

  const calls = new SqliteLlmCallRepository(database).listForRun(
    analysis.run.id,
  );
  const outputTokens = calls.reduce(
    (sum, call) => sum + (call.usage?.outputTokens ?? 0),
    0,
  );
  process.stdout.write(
    [
      "delivery smoke: PASS",
      `model_calls=${calls.length}`,
      `output_tokens=${outputTokens}`,
      `quality_score=${quality.score}`,
      `exports=${Object.entries(exportSizes)
        .map(([key, value]) => `${key}:${value}`)
        .join(",")}`,
      `restored=${restored.projectId.slice(0, 8)}`,
      `elapsed_ms=${Date.now() - wallStart}`,
    ].join(" | ") + "\n",
  );
  success = true;
} catch (error) {
  logger.event("scenario.error", {
    message: error instanceof Error ? error.message : String(error),
  });
  checks.push({
    name: "scenario completed",
    ok: false,
    detail: error instanceof Error ? error.message : String(error),
  });
  throw error;
} finally {
  watcher.stop();
  logger.event("scenario.end", {
    success,
    durationMs: Date.now() - Date.parse(startedAt),
  });
  writeSmokeSummary({
    workspace,
    database,
    scenario,
    protocols: args.protocols,
    startedAt,
    success,
    checks,
  });
  await app.close();
  database.close();
  finalizeSmokeWorkspace(workspace, {
    success,
    keepArtifacts: args.keepArtifacts,
  });
}

async function finishRun(
  app: FastifyInstance,
  runId: string,
  projectId: string,
) {
  let snapshot = await jsonRequest<RunSnapshot>(
    app,
    "GET",
    `/api/runs/${runId}?projectId=${projectId}`,
    undefined,
    [200],
  );
  for (let index = 0; index < 5_000; index += 1) {
    if (
      ["completed", "failed", "cancelled", "awaiting_user"].includes(
        snapshot.run.status,
      )
    )
      break;
    const result = await jsonRequest<{ snapshot: RunSnapshot }>(
      app,
      "POST",
      `/api/runs/${runId}/advance`,
      undefined,
      [200],
    );
    tracker.diff(runId);
    snapshot = result.snapshot;
    if (snapshot.run.status === "failed_recoverable") {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (snapshot.run.status !== "completed") {
    const failure = snapshot.steps.find(
      (step) => step.status === "failed",
    )?.error;
    throw new Error(
      `import analysis ended as ${snapshot.run.status}: ${safeError(failure)}`,
    );
  }
}

async function jsonRequest<T = unknown>(
  app: FastifyInstance,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload: Record<string, unknown> | undefined,
  expected: readonly number[],
): Promise<T> {
  const response =
    payload === undefined
      ? await app.inject({ method, url })
      : await app.inject({ method, url, payload });
  if (!expected.includes(response.statusCode)) {
    let detail: unknown;
    try {
      detail = response.json();
    } catch {
      detail = response.body;
    }
    throw new Error(
      `${method} ${url} returned ${response.statusCode}: ${safeError(detail)}`,
    );
  }
  return response.json() as T;
}

function safeError(value: unknown) {
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface ImportDetail {
  batch: { id: string; status: string; sourceCharacters: number };
  candidates: { id: string; kind: string }[];
}

interface RunSnapshot {
  run: { status: string };
  steps: { status: string; error: unknown }[];
}
