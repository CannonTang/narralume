import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import type { FastifyInstance } from "fastify";

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
  workspaceFromDir,
  type SmokeCheck,
  type SmokeWorkspace,
} from "./real-smoke-harness.js";

loadDotEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const scenario = "studio-real";
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const modelIds: Record<string, string> = {
  "openai-chat": "environment-chat",
  "openai-responses": "environment-responses",
  "anthropic-messages": "environment-anthropic",
};
const args = parseRealSmokeArgs(process.argv.slice(2), {
  script: "studio-real-smoke.ts",
  defaultProtocols: ["openai-responses"],
  singleProtocol: true,
  allowResume: true,
});

if (args.resumeFrom) {
  await resumeMain(args.resumeFrom);
} else {
  await main();
}

interface ResumeState {
  protocol: string;
  modelId: string;
  projectId: string;
  sessionId: string;
  mainBranchId: string;
  assistantTurnId: string;
  completedRunIds: string[];
  diagnostic: boolean;
  keepArtifacts: boolean;
  startedAt: string;
  checks: SmokeCheck[];
  childChecks?: SmokeCheck[];
}

async function main() {
  const protocol = args.protocols[0]!;
  const modelId = modelIds[protocol];
  if (!modelId) throw new Error(`Unsupported protocol: ${protocol}`);

  const workspace = createSmokeWorkspace(scenario, {
    outputDir: args.outputDir,
  });
  const logger = new SmokeLogger(workspace.jsonlPath, scenario, {
    diagnostic: args.diagnostic,
  });
  installSignalFlush(logger);
  const startedAt = new Date().toISOString();
  const checks: SmokeCheck[] = [];

  const database = new NodeNarrativeDatabase(workspace.dbPath);
  database.migrate();
  interruptOrphanedWork(logger, database);
  const tracker = new RunStateTracker(logger, database, {
    diagnostic: args.diagnostic,
  });
  const watcher = new RunWatcher(tracker);
  watcher.startPolling();

  logger.event("scenario.start", {
    protocols: args.protocols,
    workspace: workspace.dir,
    gitCommit: currentGitCommit(),
  });

  const recordCheck = (name: string, ok: boolean, detail?: string): void => {
    checks.push({ name, ok, ...(detail ? { detail } : {}) });
    logger.event("scenario.check", { name, ok, ...(detail ? { detail } : {}) });
  };

  let app: FastifyInstance | null = null;
  let databaseOpen = true;
  try {
    app = await createApp(database, workspace.dbPath);
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
        title: "回声邮局",
        premise:
          "退潮时营业的邮局能把未寄出的信送到记忆消失之前；每寄一封，寄信人会失去一段相关记忆。",
      },
      [201],
    );
    const author = await createPersona(app, project.id, {
      kind: "author",
      name: "执灯人",
      description: "控制故事边界的作者代理",
      instructions: "不替角色做选择；超自然规则必须通过可观察动作呈现。",
    });
    const investigator = await createPersona(app, project.id, {
      kind: "character",
      name: "沈砚",
      description: "二十七岁的纸张修复师，谨慎、敏锐，不轻信直觉。",
      instructions:
        "只根据亲眼所见作判断；先验证再冒险；紧张时会用指腹确认物体边缘。",
    });
    const narrator = await createPersona(app, project.id, {
      kind: "narrator",
      name: "潮声旁白",
      description: "贴近沈砚的有限视角叙述者",
      instructions:
        "使用克制具体的中文；让情绪通过动作和感官显现；不解释主题，不总结场景。",
    });

    const session = await jsonRequest<SessionDetail>(
      app,
      "POST",
      `/api/projects/${project.id}/cocreate/sessions`,
      {
        title: "空白信试演",
        speakerPolicy: "round_robin",
        authorPersonaId: author.id,
        participantIds: [narrator.id, investigator.id],
        directorNote:
          "场景发生在煤油灯下。用纸张、盐粒、潮气建立一条可复验规则，暂不揭示姐姐失踪的真相。",
        contextTurns: 24,
      },
      [201],
    );
    const sessionId = session.session.id;
    const mainBranchId = required(
      session.session.activeBranchId,
      "main branch",
    );

    const posted = await jsonRequest<{
      turn: { id: string };
      run: { id: string };
    }>(
      app,
      "POST",
      `/api/cocreate/sessions/${sessionId}/turns`,
      {
        role: "user",
        personaId: author.id,
        content:
          "沈砚把姐姐留下的空白信移到煤油灯上方，先在桌角放了一小碟海盐作对照。",
        generateReply: true,
      },
      [202],
    );
    logger.event("run.created", {
      runId: posted.run.id,
      projectId: project.id,
      kind: "room-reply",
    });
    watcher.track(posted.run.id);
    await finishRun(app, watcher, posted.run.id, project.id, "room reply");
    const completedRunIds: string[] = [posted.run.id];
    let room = await getRoom(app, sessionId);
    const assistant = required(
      room.turns.find((turn) => turn.role === "assistant"),
      "assistant turn",
    );
    if (assistant.personaId !== narrator.id) {
      throw new Error("round-robin did not select the first enabled persona");
    }
    process.stdout.write(
      `room reply: ${assistant.swipes.length} selected swipe, ${assistant.content.length} chars\n`,
    );
    recordCheck("room reply generated", true);

    const alternate = await jsonRequest<{ run: { id: string } }>(
      app,
      "POST",
      `/api/turns/${assistant.id}/swipes`,
      { speakerPersonaId: investigator.id },
      [202],
    );
    logger.event("run.created", {
      runId: alternate.run.id,
      projectId: project.id,
      kind: "alternate-swipe",
    });
    watcher.track(alternate.run.id);
    await finishRun(
      app,
      watcher,
      alternate.run.id,
      project.id,
      "alternate swipe",
    );
    completedRunIds.push(alternate.run.id);
    room = await getRoom(app, sessionId);
    const swipedTurn = required(
      room.turns.find((turn) => turn.id === assistant.id),
      "swiped assistant turn",
    );
    if (swipedTurn.swipes.length !== 2) {
      throw new Error(`expected two swipes, got ${swipedTurn.swipes.length}`);
    }
    await jsonRequest(
      app,
      "POST",
      `/api/turns/${assistant.id}/swipe-selection`,
      { swipeId: swipedTurn.swipes[0]!.id },
      [200],
    );
    recordCheck("alternate swipe selected", true);

    const branch = await jsonRequest<{ id: string }>(
      app,
      "POST",
      `/api/cocreate/sessions/${sessionId}/branches`,
      { fromTurnId: posted.turn.id, name: "先拆信封" },
      [201],
    );
    await jsonRequest(
      app,
      "POST",
      `/api/cocreate/sessions/${sessionId}/turns`,
      {
        role: "director",
        content: "让沈砚先检查信封胶痕，不要加热信纸。",
        generateReply: false,
      },
      [201],
    );
    await jsonRequest(
      app,
      "POST",
      `/api/cocreate/sessions/${sessionId}/branch-selection`,
      { branchId: mainBranchId },
      [200],
    );
    process.stdout.write(`branch: fork ${shortId(branch.id)} preserved\n`);
    recordCheck("branch forked", true);

    const state: ResumeState = {
      protocol,
      modelId,
      projectId: project.id,
      sessionId,
      mainBranchId,
      assistantTurnId: assistant.id,
      completedRunIds,
      diagnostic: args.diagnostic,
      keepArtifacts: args.keepArtifacts,
      startedAt,
      checks,
    };
    writeFileSync(
      join(workspace.dir, "resume-state.json"),
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );
    watcher.stop();
    await app.close();
    app = null;
    database.close();
    databaseOpen = false;

    logger.event("scenario.restart", { workspace: workspace.dir });
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(import.meta.url),
        `--resume-from=${workspace.dir}`,
      ],
      { cwd: repositoryRoot, env: process.env, stdio: "inherit" },
    );
    const resumed = readResumeState(workspace);
    const childChecks = resumed?.childChecks ?? [];
    checks.push(...childChecks);
    const restartOk =
      child.status === 0 && childChecks.every((check) => check.ok);
    checks.push({
      name: "cross-process restart recovery",
      ok: restartOk,
      detail: `child exit=${child.status ?? child.error?.message ?? "unknown"}`,
    });
    logger.event("scenario.check", {
      name: "cross-process restart recovery",
      ok: restartOk,
      exitCode: child.status,
    });
    const success = restartOk && checks.every((check) => check.ok);

    const summaryDatabase = new NodeNarrativeDatabase(workspace.dbPath);
    try {
      logger.event("scenario.end", {
        success,
        durationMs: Date.now() - Date.parse(startedAt),
      });
      writeSmokeSummary({
        workspace,
        database: summaryDatabase,
        scenario,
        protocols: args.protocols,
        startedAt,
        success,
        checks,
      });
    } finally {
      summaryDatabase.close();
    }
    finalizeSmokeWorkspace(workspace, {
      success,
      keepArtifacts: args.keepArtifacts,
    });
    if (!success) {
      process.stderr.write("studio smoke: FAIL\n");
      process.exitCode = 1;
    }
  } catch (error) {
    if (databaseOpen) watcher.stop();
    logger.event("scenario.error", {
      message: error instanceof Error ? error.message : String(error),
    });
    checks.push({
      name: "scenario completed",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
    logger.event("scenario.end", {
      success: false,
      durationMs: Date.now() - Date.parse(startedAt),
    });
    writeSmokeSummary({
      workspace,
      database: databaseOpen ? database : null,
      scenario,
      protocols: args.protocols,
      startedAt,
      success: false,
      checks,
    });
    if (app) await app.close();
    if (databaseOpen) database.close();
    finalizeSmokeWorkspace(workspace, { success: false, keepArtifacts: true });
    process.stderr.write("studio smoke: FAIL\n");
    process.exitCode = 1;
  }
}

async function resumeMain(resumeFrom: string) {
  const workspace = workspaceFromDir(resumeFrom);
  const state = readResumeState(workspace);
  if (!state) throw new Error(`missing resume state in ${resumeFrom}`);
  const logger = new SmokeLogger(workspace.jsonlPath, scenario, {
    diagnostic: state.diagnostic,
  });
  installSignalFlush(logger);
  const childChecks: SmokeCheck[] = [];
  let success = false;

  const database = new NodeNarrativeDatabase(workspace.dbPath);
  database.migrate();
  interruptOrphanedWork(logger, database);
  const tracker = new RunStateTracker(logger, database, {
    diagnostic: state.diagnostic,
  });
  const watcher = new RunWatcher(tracker);
  watcher.startPolling();
  logger.event("scenario.resumed", {
    workspace: workspace.dir,
    sessionId: state.sessionId,
  });
  const recordCheck = (name: string, ok: boolean, detail?: string): void => {
    childChecks.push({ name, ok, ...(detail ? { detail } : {}) });
    logger.event("scenario.check", { name, ok, ...(detail ? { detail } : {}) });
  };

  let app: FastifyInstance | null = null;
  try {
    app = await createApp(database, workspace.dbPath);
    let room = await getRoom(app, state.sessionId);
    if (room.turns.length !== 2 || room.branches.length !== 2) {
      throw new Error("room state did not survive app restart");
    }
    process.stdout.write(
      "recovery: room, branch, and swipes survived restart\n",
    );
    recordCheck(
      "room state survived cross-process restart",
      true,
      `${room.turns.length} turns, ${room.branches.length} branches`,
    );

    const adoptionRun = await jsonRequest<{ run: { id: string } }>(
      app,
      "POST",
      `/api/cocreate/sessions/${state.sessionId}/adoptions`,
      {
        branchId: state.mainBranchId,
        fromTurnId: room.turns[0]!.id,
        toTurnId: room.turns[1]!.id,
        title: "灯下潮痕",
      },
      [202],
    );
    logger.event("run.created", {
      runId: adoptionRun.run.id,
      projectId: state.projectId,
      kind: "scene-adoption",
    });
    watcher.track(adoptionRun.run.id);
    await finishRun(
      app,
      watcher,
      adoptionRun.run.id,
      state.projectId,
      "scene adoption",
    );
    state.completedRunIds.push(adoptionRun.run.id);
    room = await getRoom(app, state.sessionId);
    const adoption = required(room.adoptions[0], "scene adoption");
    if (!adoption.canonChangeSetId) {
      throw new Error("adoption did not stage a canon change set");
    }
    let document = await jsonRequest<StudioDocument>(
      app,
      "GET",
      `/api/projects/${state.projectId}/studio/documents/${adoption.documentId}`,
      undefined,
      [200],
    );
    const current = required(
      document.currentVersion,
      "adopted document version",
    );
    if (current.content.length < 120) {
      throw new Error(
        `adopted scene is unexpectedly short: ${current.content.length}`,
      );
    }
    process.stdout.write(
      `scene adoption: ${current.content.length} chars, canon candidate staged\n`,
    );
    recordCheck(
      "scene adoption staged canon change",
      true,
      `${current.content.length} chars`,
    );

    const selectionEnd = Math.min(100, current.content.length);
    const quote = current.content.slice(0, selectionEnd);
    await jsonRequest(
      app,
      "POST",
      `/api/projects/${state.projectId}/studio/documents/${adoption.documentId}/comments`,
      {
        versionId: current.id,
        startOffset: 0,
        endOffset: selectionEnd,
        quote,
        body: "检查这一段是否保持有限视角，并强化纸张的触感。",
      },
      [201],
    );

    const editRun = await jsonRequest<{ run: { id: string } }>(
      app,
      "POST",
      `/api/projects/${state.projectId}/studio/documents/${adoption.documentId}/selection-edits`,
      {
        baseVersionId: current.id,
        selectionStart: 0,
        selectionEnd,
        instruction:
          "保持事件、视角与专名不变，压紧句子并加强纸张和潮气的触感；不要添加新设定。",
      },
      [202],
    );
    logger.event("run.created", {
      runId: editRun.run.id,
      projectId: state.projectId,
      kind: "selection-edit",
    });
    watcher.track(editRun.run.id);
    await finishRun(
      app,
      watcher,
      editRun.run.id,
      state.projectId,
      "selection edit",
    );
    state.completedRunIds.push(editRun.run.id);
    document = await jsonRequest<StudioDocument>(
      app,
      "GET",
      `/api/projects/${state.projectId}/studio/documents/${adoption.documentId}`,
      undefined,
      [200],
    );
    const proposal = required(
      document.proposals.find((candidate) => candidate.status === "proposed"),
      "edit proposal",
    );
    await jsonRequest(
      app,
      "POST",
      `/api/studio/edit-proposals/${proposal.id}/actions`,
      { action: "accept", requestId: `${proposal.id}:accept` },
      [200],
    );
    document = await jsonRequest<StudioDocument>(
      app,
      "GET",
      `/api/projects/${state.projectId}/studio/documents/${adoption.documentId}`,
      undefined,
      [200],
    );
    if (document.versions.length !== 2 || document.comments.length !== 1) {
      throw new Error("accepted diff or anchored comment was not persisted");
    }
    recordCheck("edit proposal accepted", true);

    const calls = state.completedRunIds.flatMap((runId) =>
      new SqliteLlmCallRepository(database).listForRun(runId),
    );
    const totalOutputTokens = calls.reduce(
      (sum, call) => sum + (call.usage?.outputTokens ?? 0),
      0,
    );
    process.stdout.write(
      [
        "studio smoke: PASS",
        `runs=${state.completedRunIds.length}`,
        `model_calls=${calls.length}`,
        `output_tokens=${totalOutputTokens}`,
        `versions=${document.versions.length}`,
        `elapsed_ms=${Date.now() - Date.parse(state.startedAt)}`,
      ].join(" | ") + "\n",
    );
    success = true;
  } catch (error) {
    logger.event("scenario.error", {
      message: error instanceof Error ? error.message : String(error),
    });
    childChecks.push({
      name: "post-restart scenario",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    watcher.stop();
    writeFileSync(
      join(workspace.dir, "resume-state.json"),
      `${JSON.stringify({ ...state, childChecks }, null, 2)}\n`,
      "utf8",
    );
    if (app) await app.close();
    database.close();
    if (!success) process.exitCode = 1;
  }
}

function readResumeState(workspace: SmokeWorkspace): ResumeState | null {
  try {
    return JSON.parse(
      readFileSync(join(workspace.dir, "resume-state.json"), "utf8"),
    ) as ResumeState;
  } catch {
    return null;
  }
}

async function createApp(database: NodeNarrativeDatabase, dbPath: string) {
  const config: ServerConfig = {
    dataDirectory: ".",
    databasePath: dbPath,
    host: "127.0.0.1",
    port: 4317,
    environment: "test",
  };
  return buildApp({
    config,
    database,
    environment: process.env,
    logger: false,
    enableRunWorker: false,
  });
}

async function createPersona(
  app: FastifyInstance,
  projectId: string,
  input: Record<string, unknown>,
) {
  return jsonRequest<{ id: string }>(
    app,
    "POST",
    `/api/projects/${projectId}/personas`,
    input,
    [201],
  );
}

async function getRoom(app: FastifyInstance, sessionId: string) {
  return jsonRequest<SessionDetail>(
    app,
    "GET",
    `/api/cocreate/sessions/${sessionId}`,
    undefined,
    [200],
  );
}

async function finishRun(
  app: FastifyInstance,
  watcher: RunWatcher,
  runId: string,
  projectId: string,
  label: string,
) {
  let snapshot = await jsonRequest<RunSnapshot>(
    app,
    "GET",
    `/api/runs/${runId}?projectId=${projectId}`,
    undefined,
    [200],
  );
  let lastStep = "";
  for (let index = 0; index < 5_000; index += 1) {
    if (
      ["completed", "failed", "cancelled", "awaiting_user"].includes(
        snapshot.run.status,
      )
    )
      break;
    const step =
      snapshot.steps.find((candidate) => candidate.status === "running") ??
      snapshot.steps.find((candidate) => candidate.status === "pending");
    if (step?.kind && step.kind !== lastStep) {
      process.stdout.write(`${label}: ${step.kind}\n`);
      lastStep = step.kind;
    }
    const result = await jsonRequest<{ snapshot: RunSnapshot }>(
      app,
      "POST",
      `/api/runs/${runId}/advance`,
      undefined,
      [200],
    );
    watcher.diffAll();
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
      `${label} ended as ${snapshot.run.status}: ${safeError(failure)}`,
    );
  }
}

async function jsonRequest<T = unknown>(
  target: FastifyInstance,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload: Record<string, unknown> | undefined,
  expected: readonly number[],
): Promise<T> {
  const response =
    payload === undefined
      ? await target.inject({ method, url })
      : await target.inject({ method, url, payload });
  if (!expected.includes(response.statusCode)) {
    let error: unknown;
    try {
      error = response.json();
    } catch {
      error = { statusCode: response.statusCode };
    }
    throw new Error(
      `${method} ${url} returned ${response.statusCode}: ${safeError(error)}`,
    );
  }
  return response.json() as T;
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined)
    throw new Error(`missing ${label}`);
  return value;
}

function shortId(value: string) {
  return value.slice(0, 8);
}

function safeError(value: unknown) {
  if (!value || typeof value !== "object") return "no structured error";
  const record = value as Record<string, unknown>;
  const nested =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : record;
  return (
    [nested.code, nested.message]
      .filter((item) => typeof item === "string")
      .join(" | ") || "unknown error"
  );
}

interface RunSnapshot {
  run: { id: string; status: string };
  steps: {
    kind: string;
    status: string;
    error: Record<string, unknown> | null;
  }[];
}

interface SessionDetail {
  session: { id: string; activeBranchId: string | null };
  branches: { id: string }[];
  turns: {
    id: string;
    role: string;
    personaId: string | null;
    content: string;
    swipes: { id: string; content: string }[];
  }[];
  adoptions: {
    documentId: string;
    canonChangeSetId: string | null;
  }[];
}

interface StudioDocument {
  currentVersion: { id: string; content: string } | null;
  versions: { id: string }[];
  comments: { id: string }[];
  proposals: { id: string; status: string }[];
}
