import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scrubSecrets } from "@narrative-lantern/llm";
import {
  resolveCredential,
  SqliteAssignmentRepository,
  SqliteLlmCallRepository,
  SqliteModelRepository,
  SqliteProviderRepository,
  SqliteRunStreamRepository,
  type NarrativeDatabase,
} from "@narrative-lantern/persistence";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const MAX_LOG_STRING = 240;

export function configureSmokeModelTarget(
  database: NarrativeDatabase,
  modelId: string,
) {
  const model = new SqliteModelRepository(database).get(modelId);
  const provider = model
    ? new SqliteProviderRepository(database).get(model.providerId)
    : null;
  const credential = provider ? resolveCredential(provider, process.env) : null;
  if (!model || !provider || !credential?.ok) return null;
  new SqliteAssignmentRepository(database).set(
    "writing",
    model.id,
    new Date().toISOString(),
  );
  return { model, provider };
}

export interface RealSmokeArgs {
  protocols: string[];
  diagnostic: boolean;
  chapters: number | null;
  keepArtifacts: boolean;
  outputDir: string | null;
  resumeFrom: string | null;
}

export function parseRealSmokeArgs(
  argv: readonly string[],
  options: {
    script: string;
    defaultProtocols: readonly string[];
    singleProtocol?: boolean;
    chaptersDefault?: number;
    allowResume?: boolean;
  },
): RealSmokeArgs {
  const usage = [
    `Usage: tsx scripts/${options.script} [options]`,
    "  --protocol=a,b,c     protocol list" +
      (options.singleProtocol
        ? ` (exactly one, default ${options.defaultProtocols[0]})`
        : ` (default ${options.defaultProtocols.join(",")}`),
    "  --diagnostic         verbose events (context receipts, run event payloads)",
    ...(options.chaptersDefault !== undefined
      ? [
          `  --chapters=N         chapter target (default ${options.chaptersDefault})`,
        ]
      : []),
    "  --keep-artifacts     keep the sqlite database on success",
    "  --output-dir=<path>  workspace root (default .tmp/real-smoke)",
    ...(options.allowResume
      ? ["  --resume-from=<dir>  internal: run the post-restart half"]
      : []),
  ].join("\n");

  let protocols: string[] | null = null;
  let diagnostic = false;
  let chapters: number | null = options.chaptersDefault ?? null;
  let keepArtifacts = false;
  let outputDir: string | null = null;
  let resumeFrom: string | null = null;

  for (const argument of argv) {
    if (argument.startsWith("--protocol=")) {
      protocols = argument
        .slice("--protocol=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (protocols.length === 0) throw new Error(usage);
    } else if (argument === "--diagnostic") {
      diagnostic = true;
    } else if (argument.startsWith("--chapters=")) {
      if (options.chaptersDefault === undefined) throw new Error(usage);
      const value = Number(argument.slice("--chapters=".length));
      if (!Number.isInteger(value) || value < 1 || value > 50)
        throw new Error(usage);
      chapters = value;
    } else if (argument === "--keep-artifacts") {
      keepArtifacts = true;
    } else if (argument.startsWith("--output-dir=")) {
      outputDir = argument.slice("--output-dir=".length).trim();
      if (!outputDir) throw new Error(usage);
    } else if (argument.startsWith("--resume-from=")) {
      if (!options.allowResume) throw new Error(usage);
      resumeFrom = argument.slice("--resume-from=".length).trim();
      if (!resumeFrom) throw new Error(usage);
    } else {
      throw new Error(usage);
    }
  }

  const selected = protocols ?? [...options.defaultProtocols];
  if (options.singleProtocol && selected.length !== 1) throw new Error(usage);
  return {
    protocols: selected,
    diagnostic,
    chapters,
    keepArtifacts,
    outputDir,
    resumeFrom,
  };
}

export interface SmokeWorkspace {
  dir: string;
  dbPath: string;
  jsonlPath: string;
  summaryPath: string;
}

export function createSmokeWorkspace(
  scenario: string,
  options: { outputDir?: string | null } = {},
): SmokeWorkspace {
  const root = options.outputDir
    ? resolve(options.outputDir)
    : join(repositoryRoot, ".tmp", "real-smoke");
  mkdirSync(root, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "");
  let dir = join(root, `${stamp}-${scenario}`);
  for (let suffix = 1; existsSync(dir); suffix += 1) {
    dir = join(root, `${stamp}-${scenario}-${suffix}`);
  }
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    dbPath: join(dir, "smoke.sqlite"),
    jsonlPath: join(dir, "events.jsonl"),
    summaryPath: join(dir, "summary.json"),
  };
}

export function workspaceFromDir(dir: string): SmokeWorkspace {
  const resolved = resolve(dir);
  return {
    dir: resolved,
    dbPath: join(resolved, "smoke.sqlite"),
    jsonlPath: join(resolved, "events.jsonl"),
    summaryPath: join(resolved, "summary.json"),
  };
}

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    const scrubbed = scrubSecrets(value);
    const length = [...scrubbed].length;
    if (length <= MAX_LOG_STRING) return scrubbed;
    return { hash: sha256(scrubbed), length };
  }
  if (value instanceof Error) {
    return redact({
      name: value.name,
      message: value.message,
      ...(value.cause ? { cause: String(value.cause) } : {}),
    });
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = isSecretField(key) ? "[REDACTED]" : redact(entry);
    }
    return output;
  }
  return value;
}

function isSecretField(key: string): boolean {
  const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
  return (
    normalized === "authorization" ||
    normalized === "key" ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("subscriptionkey") ||
    normalized.endsWith("accesskey") ||
    normalized.endsWith("secretkey") ||
    normalized.endsWith("token") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("password") ||
    normalized === "credential" ||
    normalized === "credentialref" ||
    normalized === "sig" ||
    normalized.endsWith("signature")
  );
}

export class SmokeLogger {
  private readonly diagnostic: boolean;

  constructor(
    private readonly jsonlPath: string,
    private readonly scenario: string,
    options: { diagnostic?: boolean } = {},
  ) {
    this.diagnostic = options.diagnostic ?? false;
  }

  get verbose(): boolean {
    return this.diagnostic;
  }

  event(type: string, data: Record<string, unknown> = {}): void {
    const safe = redact(data) as Record<string, unknown>;
    appendFileSync(
      this.jsonlPath,
      `${JSON.stringify({ ts: new Date().toISOString(), type, ...safe })}\n`,
      "utf8",
    );
    const detail = Object.entries(safe)
      .map(([key, value]) => `${key}=${compact(value)}`)
      .join(" ");
    process.stderr.write(
      `[${this.scenario}] ${type}${detail ? ` ${detail}` : ""}\n`,
    );
  }

  info(message: string, data: Record<string, unknown> = {}): void {
    this.event("info", { message, ...data });
  }

  warn(message: string, data: Record<string, unknown> = {}): void {
    this.event("warn", { message, ...data });
  }

  error(message: string, data: Record<string, unknown> = {}): void {
    this.event("error", { message, ...data });
  }
}

export function installSignalFlush(logger: SmokeLogger): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      logger.event("process.signal", { signal });
      process.exit(signal === "SIGINT" ? 130 : 143);
    });
  }
}

interface TrackedRun {
  runStatus: string | null;
  steps: Map<string, string>;
  calls: Map<string, string>;
  lastEventSequence: number;
  receipts: Set<string>;
}

export class RunStateTracker {
  private readonly states = new Map<string, TrackedRun>();
  private readonly diagnostic: boolean;

  constructor(
    private readonly logger: SmokeLogger,
    private readonly database: NarrativeDatabase,
    options: { diagnostic?: boolean } = {},
  ) {
    this.diagnostic = options.diagnostic ?? false;
  }

  diff(runId: string): void {
    const state = this.states.get(runId) ?? {
      runStatus: null,
      steps: new Map(),
      calls: new Map(),
      lastEventSequence: -1,
      receipts: new Set(),
    };
    this.states.set(runId, state);

    const run = this.database.raw
      .prepare("SELECT status, started_at, finished_at FROM runs WHERE id = ?")
      .get(runId) as
      | {
          status: string;
          started_at: string | null;
          finished_at: string | null;
        }
      | undefined;
    if (run && run.status !== state.runStatus) {
      this.logger.event("run.status", {
        runId,
        status: run.status,
        ...(state.runStatus ? { previous: state.runStatus } : {}),
        ...(run.started_at ? { startedAt: run.started_at } : {}),
        ...(run.finished_at ? { finishedAt: run.finished_at } : {}),
      });
      state.runStatus = run.status;
    }

    const steps = this.database.raw
      .prepare(
        `SELECT id, kind, status, attempt, started_at, finished_at, error_json
         FROM run_steps WHERE run_id = ? ORDER BY ordinal`,
      )
      .all(runId) as unknown as StepRow[];
    for (const step of steps) {
      const marker = `${step.status}#${step.attempt}`;
      if (state.steps.get(step.id) === marker) continue;
      state.steps.set(step.id, marker);
      const error = parseError(step.error_json);
      this.logger.event("run.step", {
        runId,
        stepId: step.id,
        kind: step.kind,
        status: step.status,
        attempt: step.attempt,
        ...(step.started_at ? { startedAt: step.started_at } : {}),
        ...(step.finished_at ? { finishedAt: step.finished_at } : {}),
        ...(error ? { error } : {}),
      });
    }

    const calls = this.database.raw
      .prepare(
        `SELECT id, step_id, purpose, status, started_at, finished_at,
           duration_ms, error_json, response_id, finish_reason
         FROM llm_calls WHERE run_id = ? ORDER BY started_at`,
      )
      .all(runId) as unknown as CallRow[];
    for (const call of calls) {
      if (state.calls.get(call.id) === call.status) continue;
      state.calls.set(call.id, call.status);
      const error = parseError(call.error_json);
      this.logger.event("llm.call", {
        runId,
        callId: call.id,
        stepId: call.step_id,
        purpose: call.purpose,
        status: call.status,
        startedAt: call.started_at,
        ...(call.finished_at ? { finishedAt: call.finished_at } : {}),
        ...(call.duration_ms !== null ? { durationMs: call.duration_ms } : {}),
        ...(call.finish_reason ? { finishReason: call.finish_reason } : {}),
        ...(call.response_id ? { responseId: call.response_id } : {}),
        ...(error ? { error } : {}),
      });
    }

    if (this.diagnostic) {
      const events = this.database.raw
        .prepare(
          `SELECT sequence, type, step_id, payload_json FROM run_events
           WHERE run_id = ? AND sequence > ? ORDER BY sequence`,
        )
        .all(runId, state.lastEventSequence) as unknown as EventRow[];
      for (const event of events) {
        state.lastEventSequence = event.sequence;
        this.logger.event("run.event", {
          runId,
          sequence: event.sequence,
          eventType: event.type,
          ...(event.step_id ? { stepId: event.step_id } : {}),
          payload: JSON.parse(event.payload_json),
        });
      }
      const receipts = this.database.raw
        .prepare(
          `SELECT id, purpose, compiled_hash, created_at FROM context_receipts
           WHERE run_id = ? ORDER BY created_at`,
        )
        .all(runId) as unknown as ReceiptRow[];
      for (const receipt of receipts) {
        if (state.receipts.has(receipt.id)) continue;
        state.receipts.add(receipt.id);
        this.logger.event("context.receipt", {
          runId,
          receiptId: receipt.id,
          purpose: receipt.purpose,
          compiledHash: receipt.compiled_hash,
          createdAt: receipt.created_at,
        });
      }
    }
  }
}

export class RunWatcher {
  private readonly tracker: RunStateTracker;
  private readonly runIds = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(tracker: RunStateTracker) {
    this.tracker = tracker;
  }

  track(runId: string): void {
    this.runIds.add(runId);
    this.tracker.diff(runId);
  }

  diffAll(): void {
    for (const runId of this.runIds) this.tracker.diff(runId);
  }

  startPolling(intervalMs = 1_500): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.diffAll(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.diffAll();
  }
}

export function interruptOrphanedWork(
  logger: SmokeLogger,
  database: NarrativeDatabase,
): void {
  const llmCalls = new SqliteLlmCallRepository(database).interruptOrphaned();
  const streamAttempts = new SqliteRunStreamRepository(
    database,
  ).interruptOrphaned();
  logger.event("recovery.interrupted", { llmCalls, streamAttempts });
}

export interface SmokeCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export function writeSmokeSummary(input: {
  workspace: SmokeWorkspace;
  database?: NarrativeDatabase | null;
  scenario: string;
  protocols: readonly string[];
  startedAt: string;
  success: boolean;
  checks: readonly SmokeCheck[];
  extra?: Record<string, unknown>;
}): void {
  const finishedAt = new Date().toISOString();
  const summary = {
    scenario: input.scenario,
    protocols: input.protocols,
    gitCommit: gitCommit(),
    startedAt: input.startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(input.startedAt),
    success: input.success,
    checks: input.checks,
    aggregates: input.database ? collectAggregates(input.database) : null,
    execution: input.database ? collectExecutionEvidence(input.database) : null,
    artifacts: artifactList(input.workspace),
    extra: input.extra ?? {},
  };
  writeFileSync(
    input.workspace.summaryPath,
    `${JSON.stringify(redact(summary), null, 2)}\n`,
    "utf8",
  );
  process.stderr.write(
    `[${input.scenario}] summary: ${input.workspace.summaryPath}\n`,
  );
}

export function finalizeSmokeWorkspace(
  workspace: SmokeWorkspace,
  options: { success: boolean; keepArtifacts: boolean },
): void {
  if (!options.success || options.keepArtifacts) return;
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${workspace.dbPath}${suffix}`, { force: true });
  }
}

export function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return "unparseable";
  }
}

export function currentGitCommit(): string | null {
  return gitCommit();
}

function collectAggregates(database: NarrativeDatabase) {
  const calls = database.raw
    .prepare(
      `SELECT id, run_id, step_id, purpose, status, started_at, finished_at,
         protocol, model, duration_ms, usage_json, error_json, details_json
       FROM llm_calls ORDER BY started_at`,
    )
    .all() as unknown as AggregateCallRow[];
  const retriedSteps = (
    database.raw
      .prepare("SELECT COUNT(*) AS count FROM run_steps WHERE attempt > 1")
      .get() as { count: number }
  ).count;
  const partialStreamChars = (
    database.raw
      .prepare(
        "SELECT COALESCE(SUM(LENGTH(content)), 0) AS total FROM run_stream_attempts",
      )
      .get() as { total: number }
  ).total;
  return summarizeCallRows(calls, retriedSteps, partialStreamChars);
}

export function summarizeCallRows(
  calls: readonly AggregateCallRow[],
  retriedSteps: number,
  partialStreamChars: number,
) {
  let inputTokens = 0;
  let outputTokens = 0;
  let physicalCalls = 0;
  let repairCalls = 0;
  const byStatus: Record<string, number> = {};
  const parsed = calls.map((call) => {
    byStatus[call.status] = (byStatus[call.status] ?? 0) + 1;
    const usage = parseJsonObject(call.usage_json);
    const details = parseJsonObject(call.details_json);
    inputTokens += numberField(usage, "inputTokens");
    outputTokens += numberField(usage, "outputTokens");
    const callPhysicalAttempts = numberField(details, "physicalAttempts");
    const callRepairAttempts = numberField(details, "repairAttempts");
    physicalCalls += callPhysicalAttempts;
    repairCalls += callRepairAttempts;
    return {
      id: call.id,
      runId: call.run_id,
      stepId: call.step_id,
      purpose: call.purpose,
      protocol: call.protocol,
      model: call.model,
      status: call.status,
      startedAt: call.started_at,
      finishedAt: call.finished_at,
      durationMs: call.duration_ms,
      physicalAttempts: callPhysicalAttempts,
      repairAttempts: callRepairAttempts,
      ...(call.error_json ? { error: parseError(call.error_json) } : {}),
    };
  });
  return {
    llmCalls: calls.length,
    physicalCalls,
    transportRetries: 0,
    llmCallsByStatus: byStatus,
    inputTokens,
    outputTokens,
    retriedSteps,
    repairCalls,
    partialStreamChars,
    calls: parsed,
  };
}

function collectExecutionEvidence(database: NarrativeDatabase) {
  const runs = database.raw
    .prepare(
      `SELECT id, recipe, status, policy_json, budget_used_json
       FROM runs ORDER BY created_at, id`,
    )
    .all() as unknown as RunEvidenceRow[];
  const snapshots = database.raw
    .prepare(
      `SELECT run_id, purpose, requested_role, assignment_role, model_id,
              provider_json, model_json, applied_json, created_at
       FROM model_assignment_snapshots ORDER BY run_id, purpose`,
    )
    .all() as unknown as ModelSnapshotEvidenceRow[];
  const snapshotsByRun = new Map<string, unknown[]>();
  for (const snapshot of snapshots) {
    const entries = snapshotsByRun.get(snapshot.run_id) ?? [];
    entries.push({
      purpose: snapshot.purpose,
      requestedRole: snapshot.requested_role,
      assignmentRole: snapshot.assignment_role,
      modelId: snapshot.model_id,
      provider: parseJsonObject(snapshot.provider_json),
      model: parseJsonObject(snapshot.model_json),
      applied: parseJsonObject(snapshot.applied_json),
      createdAt: snapshot.created_at,
    });
    snapshotsByRun.set(snapshot.run_id, entries);
  }
  return {
    retryOwner: "harness",
    transportMaxRetries: 0,
    runs: runs.map((run) => ({
      runId: run.id,
      recipe: run.recipe,
      status: run.status,
      effectivePolicy: parseJsonObject(run.policy_json),
      budgetUsage: parseJsonObject(run.budget_used_json),
      modelSnapshots: snapshotsByRun.get(run.id) ?? [],
    })),
  };
}

function artifactList(workspace: SmokeWorkspace) {
  return readdirSync(workspace.dir)
    .filter((name) => name !== "summary.json")
    .map((name) => {
      const path = join(workspace.dir, name);
      return {
        file: name,
        bytes: statSync(path).size,
        sha256: sha256(readFileSync(path)),
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file, "en"));
}

function gitCommit(): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function parseError(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const error = JSON.parse(json) as Record<string, unknown>;
    return {
      code: typeof error.code === "string" ? error.code : "unknown",
      message: typeof error.message === "string" ? error.message : "",
    };
  } catch {
    return { code: "unparseable", message: "" };
  }
}

function parseJsonObject(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function numberField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compact(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 80 ? `${value.slice(0, 80)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const json = JSON.stringify(value);
  return json.length > 120 ? `${json.slice(0, 120)}…` : json;
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

interface StepRow {
  id: string;
  kind: string;
  status: string;
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
  error_json: string | null;
}

interface CallRow {
  id: string;
  step_id: string;
  purpose: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error_json: string | null;
  response_id: string | null;
  finish_reason: string | null;
}

interface EventRow {
  sequence: number;
  type: string;
  step_id: string | null;
  payload_json: string;
}

interface ReceiptRow {
  id: string;
  purpose: string;
  compiled_hash: string;
  created_at: string;
}

export interface AggregateCallRow {
  id: string;
  run_id: string | null;
  step_id: string | null;
  purpose: string;
  protocol: string;
  model: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  usage_json: string | null;
  error_json: string | null;
  details_json: string | null;
}

interface RunEvidenceRow {
  id: string;
  recipe: string;
  status: string;
  policy_json: string;
  budget_used_json: string;
}

interface ModelSnapshotEvidenceRow {
  run_id: string;
  purpose: string;
  requested_role: string;
  assignment_role: string;
  model_id: string;
  provider_json: string;
  model_json: string;
  applied_json: string;
  created_at: string;
}
