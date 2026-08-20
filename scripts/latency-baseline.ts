import { appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { config as loadDotEnv } from "dotenv";

import {
  ModelError,
  ModelGateway,
  createModelAdapter,
  scrubSecrets,
  type ModelCallTiming,
  type ModelProtocol,
  type ModelRequest,
  type NormalizedUsage,
  type StructuredAttemptMode,
} from "@narrative-lantern/llm";

import {
  createSmokeWorkspace,
  currentGitCommit,
  finalizeSmokeWorkspace,
  installSignalFlush,
  originOf,
  parseRealSmokeArgs,
  SmokeLogger,
  writeSmokeSummary,
  type SmokeCheck,
} from "./real-smoke-harness.js";

loadDotEnv({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const scenario = "latency-baseline";
const DEFAULT_PROTOCOLS: ModelProtocol[] = [
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
];
const TINY_PROMPT = "用一个字回答：1+1=?";
const CHAPTER_TARGET_CHARS = 8_000;
const CHAPTER_MAX_OUTPUT_TOKENS = 2_000;

interface LatencyArgs {
  runs: number;
  rest: string[];
}

function parseLatencyArgs(argv: readonly string[]): LatencyArgs {
  let runs = 3;
  const rest: string[] = [];
  for (const argument of argv) {
    if (argument.startsWith("--runs=")) {
      const value = Number(argument.slice("--runs=".length));
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        throw new Error(
          `Usage: tsx scripts/${"latency-baseline.ts"} [--protocol=a,b,c] [--runs=N] [--diagnostic] [--keep-artifacts] [--output-dir=<path>]`,
        );
      }
      runs = value;
    } else {
      rest.push(argument);
    }
  }
  return { runs, rest };
}

const latencyArgs = parseLatencyArgs(process.argv.slice(2));
const args = parseRealSmokeArgs(latencyArgs.rest, {
  script: "latency-baseline.ts",
  defaultProtocols: DEFAULT_PROTOCOLS,
});
const workspace = createSmokeWorkspace(scenario, { outputDir: args.outputDir });
const logger = new SmokeLogger(workspace.jsonlPath, scenario, {
  diagnostic: args.diagnostic,
});
installSignalFlush(logger);
const startedAt = new Date().toISOString();
const checks: SmokeCheck[] = [];

const environment = process.env;

const definitions: {
  protocol: ModelProtocol;
  key: string;
  base: string;
  model: string;
}[] = [
  {
    protocol: "openai-chat",
    key: "NARRATIVE_CHAT_API_KEY",
    base: "NARRATIVE_CHAT_BASE_URL",
    model: "NARRATIVE_CHAT_MODEL",
  },
  {
    protocol: "openai-responses",
    key: "NARRATIVE_RESPONSES_API_KEY",
    base: "NARRATIVE_RESPONSES_BASE_URL",
    model: "NARRATIVE_RESPONSES_MODEL",
  },
  {
    protocol: "anthropic-messages",
    key: "NARRATIVE_ANTHROPIC_API_KEY",
    base: "NARRATIVE_ANTHROPIC_BASE_URL",
    model: "NARRATIVE_ANTHROPIC_MODEL",
  },
];

function findKeyEnvironment(names: readonly string[]): string | null {
  return names.find((name) => Boolean(environment[name]?.trim())) ?? null;
}

function findValue(names: readonly string[]): string | null {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  return null;
}

const defaultKeyEnv = findKeyEnvironment(["NARRATIVE_LLM_API_KEY"]);
const defaultBase = findValue(["NARRATIVE_LLM_BASE_URL"]);
const defaultModel = findValue(["NARRATIVE_LLM_MODEL"]);

interface AttemptLogEntry {
  attempt: number;
  mode: StructuredAttemptMode;
  valid: boolean;
  issues: readonly string[];
}

interface CallSample {
  protocol: ModelProtocol;
  scenario: string;
  runIndex: number;
  ok: boolean;
  timing: ModelCallTiming | null;
  usage: NormalizedUsage | null;
  finishReason: string | null;
  mode: StructuredAttemptMode | null;
  attempts: number | null;
  attemptLog: AttemptLogEntry[] | null;
  requestId: string | null;
  tokensPerSecond: number | null;
  error: {
    category: string;
    code: string | null;
    status: number | null;
    message: string;
  } | null;
}

interface ProtocolResult {
  protocol: ModelProtocol;
  status: "ok" | "unsupported" | "unconfigured" | "probe-error";
  detail: string | null;
  model: string | null;
  baseUrlOrigin: string | null;
  samples: CallSample[];
}

function tokensPerSecond(
  usage: NormalizedUsage | null,
  timing: ModelCallTiming | null,
): number | null {
  if (!usage || !timing || usage.outputTokens <= 0) return null;
  const decodeMs =
    timing.streamActiveMs !== undefined && timing.streamActiveMs > 0
      ? timing.streamActiveMs
      : timing.totalDurationMs;
  if (!decodeMs || decodeMs <= 0) return null;
  return Math.round((usage.outputTokens / (decodeMs / 1_000)) * 10) / 10;
}

function errorInfo(error: unknown): CallSample["error"] {
  if (error instanceof ModelError) {
    return {
      category: error.category,
      code: error.code ?? null,
      status: error.status ?? null,
      message: error.message.slice(0, 300),
    };
  }
  return {
    category: "unknown",
    code: null,
    status: null,
    message: scrubSecrets(
      error instanceof Error ? error.message : String(error),
    ).slice(0, 300),
  };
}

// llm.timing 事件直接写 JSONL，保留基线专用的紧凑输出结构。
function logSample(sample: CallSample): void {
  appendFileSync(
    workspace.jsonlPath,
    `${JSON.stringify({ ts: new Date().toISOString(), type: "llm.timing", ...sample })}\n`,
    "utf8",
  );
}

function buildChapterContext(targetChars: number): string {
  const beats = [
    "天色将明，营地边缘的哨兵换岗，主角检查随身装备并回忆昨夜的异动。",
    "队伍沿河谷前进，途中发现被遗弃的货车与打斗痕迹，气氛逐渐紧张。",
    "向导讲述十年前此地发生的灾祸，众人对前方废墟的态度产生分歧。",
    "午后突降暴雨，队伍被迫进入山洞躲避，洞壁上留有前人刻下的警告。",
    "夜幕降临，篝火旁众人商议明日路线，主角独自守夜时听到远处的号角。",
  ];
  const parts: string[] = [];
  let total = 0;
  let index = 1;
  while (total < targetChars) {
    const beat = beats[(index - 1) % beats.length];
    const paragraph = `第${index}节。${beat}（场景${Math.ceil(index / beats.length)}，节拍${index}，众人状态稳定，补给尚可维持三日。）`;
    parts.push(paragraph);
    total += paragraph.length;
    index += 1;
  }
  return parts.join("\n");
}

function tinyRequest(model: string): ModelRequest {
  return {
    model,
    messages: [{ role: "user", content: TINY_PROMPT }],
    maxOutputTokens: 16,
    temperature: 0,
  };
}

interface TinySchemaValue {
  title: string;
  chapter: number;
  mood: string;
}

const tinySchema = {
  name: "scene_summary",
  description: "场景摘要",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "场景标题" },
      chapter: { type: "number", description: "章节序号" },
      mood: { type: "string", description: "氛围词" },
    },
    required: ["title", "chapter", "mood"],
    additionalProperties: false,
  },
} as const;

function structuredRequest(model: string): ModelRequest {
  return {
    model,
    messages: [
      {
        role: "user",
        content: "为第 3 章的雨夜山洞场景生成摘要信息。",
      },
    ],
    maxOutputTokens: 256,
    temperature: 0,
    responseSchema: tinySchema,
  };
}

function validateTinySchema(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return { success: false as const, issues: ["not an object"] };
  }
  const record = value as Record<string, unknown>;
  const issues: string[] = [];
  if (typeof record.title !== "string") issues.push("title must be string");
  if (typeof record.chapter !== "number") issues.push("chapter must be number");
  if (typeof record.mood !== "string") issues.push("mood must be string");
  if (issues.length > 0) return { success: false as const, issues };
  return {
    success: true as const,
    data: {
      title: record.title as string,
      chapter: record.chapter as number,
      mood: record.mood as string,
    },
  };
}

async function runTextCall(
  gateway: ModelGateway,
  request: ModelRequest,
  stream: boolean,
): Promise<{
  timing: ModelCallTiming | null;
  usage: NormalizedUsage | null;
  finishReason: string | null;
  requestId: string | null;
}> {
  const response = await gateway.generate(request, { stream });
  return {
    timing: response.timing ?? null,
    usage: response.usage,
    finishReason: response.finishReason,
    requestId: response.requestId ?? null,
  };
}

async function runScenario(
  gateway: ModelGateway,
  model: string,
  scenarioName: string,
  runIndex: number,
): Promise<CallSample> {
  const base: Omit<
    CallSample,
    | "ok"
    | "timing"
    | "usage"
    | "finishReason"
    | "mode"
    | "attempts"
    | "attemptLog"
    | "requestId"
    | "tokensPerSecond"
    | "error"
  > = {
    protocol: gateway.protocol,
    scenario: scenarioName,
    runIndex,
  };
  try {
    if (
      scenarioName === "probe" ||
      scenarioName === "tiny-nonstream" ||
      scenarioName === "tiny-stream"
    ) {
      const result = await runTextCall(
        gateway,
        tinyRequest(model),
        scenarioName === "tiny-stream",
      );
      return {
        ...base,
        ok: true,
        timing: result.timing,
        usage: result.usage,
        finishReason: result.finishReason,
        mode: null,
        attempts: 1,
        attemptLog: null,
        requestId: result.requestId,
        tokensPerSecond: tokensPerSecond(result.usage, result.timing),
        error: null,
      };
    }
    if (scenarioName === "structured-small") {
      const attemptLog: AttemptLogEntry[] = [];
      const result = await gateway.generateStructured(
        structuredRequest(model),
        validateTinySchema,
        {
          maxRepairAttempts: 0,
          onAttempt: (event) => {
            attemptLog.push({
              attempt: event.attempt,
              mode: event.mode,
              valid: event.valid,
              issues: event.issues.slice(0, 3),
            });
          },
        },
      );
      return {
        ...base,
        ok: true,
        timing: result.response.timing ?? null,
        usage: result.usage,
        finishReason: result.response.finishReason,
        mode: result.mode,
        attempts: result.attempts,
        attemptLog,
        requestId: result.response.requestId ?? null,
        tokensPerSecond: tokensPerSecond(
          result.usage,
          result.response.timing ?? null,
        ),
        error: null,
      };
    }
    if (scenarioName === "structured-repair") {
      // preferPrompt 让首轮走 prompt 档；校验器第一次必败，迫使管线恰好
      // 进入一次 repair 轮（attempts=2, mode=repair）。
      const attemptLog: AttemptLogEntry[] = [];
      let calls = 0;
      const result = await gateway.generateStructured<TinySchemaValue>(
        structuredRequest(model),
        (value) => {
          calls += 1;
          if (calls === 1) {
            return {
              success: false as const,
              issues: ["forced failure: baseline repair measurement"],
            };
          }
          return validateTinySchema(value);
        },
        {
          maxRepairAttempts: 1,
          preferPrompt: true,
          onAttempt: (event) => {
            attemptLog.push({
              attempt: event.attempt,
              mode: event.mode,
              valid: event.valid,
              issues: event.issues.slice(0, 3),
            });
          },
        },
      );
      return {
        ...base,
        ok: true,
        timing: result.response.timing ?? null,
        usage: result.usage,
        finishReason: result.response.finishReason,
        mode: result.mode,
        attempts: result.attempts,
        attemptLog,
        requestId: result.response.requestId ?? null,
        tokensPerSecond: tokensPerSecond(
          result.usage,
          result.response.timing ?? null,
        ),
        error: null,
      };
    }
    // chapter-prompt
    const context = buildChapterContext(CHAPTER_TARGET_CHARS);
    const request: ModelRequest = {
      model,
      instructions:
        "你是一名长篇网络小说作者。根据给定的故事上下文，续写下一章草稿，保持人物与设定一致。",
      messages: [
        {
          role: "user",
          content: `【故事上下文】\n${context}\n\n【任务】基于以上上下文，撰写下一章草稿的开头部分，约 ${CHAPTER_MAX_OUTPUT_TOKENS} token 以内，从队伍清晨离开山洞写起。`,
        },
      ],
      maxOutputTokens: CHAPTER_MAX_OUTPUT_TOKENS,
      temperature: 0.7,
    };
    const result = await runTextCall(gateway, request, true);
    return {
      ...base,
      ok: true,
      timing: result.timing,
      usage: result.usage,
      finishReason: result.finishReason,
      mode: null,
      attempts: 1,
      attemptLog: null,
      requestId: result.requestId,
      tokensPerSecond: tokensPerSecond(result.usage, result.timing),
      error: null,
    };
  } catch (error) {
    const modelError = error instanceof ModelError ? error : null;
    return {
      ...base,
      ok: false,
      timing: modelError?.timing ?? null,
      usage: null,
      finishReason: null,
      mode: null,
      attempts: null,
      attemptLog: null,
      requestId: modelError?.requestId ?? null,
      tokensPerSecond: null,
      error: errorInfo(error),
    };
  }
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const lowerValue = sorted[lower] as number;
  if (lower === upper) return lowerValue;
  const upperValue = sorted[upper] as number;
  const fraction = rank - lower;
  return Math.round(lowerValue + (upperValue - lowerValue) * fraction);
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

function summarizeScenario(samples: readonly CallSample[]) {
  const okSamples = samples.filter((sample) => sample.ok);
  const ttft = okSamples
    .map((sample) => sample.timing?.timeToFirstTokenMs)
    .filter((value): value is number => value !== undefined);
  const tth = okSamples
    .map((sample) => sample.timing?.timeToHeadersMs)
    .filter((value): value is number => value !== undefined);
  const total = okSamples
    .map((sample) => sample.timing?.totalDurationMs)
    .filter((value): value is number => value !== undefined);
  const tps = okSamples
    .map((sample) => sample.tokensPerSecond)
    .filter((value): value is number => value !== null);
  const modes: Record<string, number> = {};
  for (const sample of okSamples) {
    if (sample.mode) modes[sample.mode] = (modes[sample.mode] ?? 0) + 1;
  }
  const errors = samples
    .filter((sample) => !sample.ok)
    .map((sample) => sample.error);
  return {
    samples: samples.length,
    ok: okSamples.length,
    timeToHeadersMs: { p50: percentile(tth, 50), p95: percentile(tth, 95) },
    timeToFirstTokenMs: {
      p50: percentile(ttft, 50),
      p95: percentile(ttft, 95),
    },
    totalDurationMs: {
      p50: percentile(total, 50),
      p95: percentile(total, 95),
    },
    tokensPerSecondMean: mean(tps),
    modes: Object.keys(modes).length > 0 ? modes : null,
    errors: errors.length > 0 ? errors : null,
  };
}

logger.event("scenario.start", {
  protocols: args.protocols,
  runs: latencyArgs.runs,
  workspace: workspace.dir,
  gitCommit: currentGitCommit(),
});

const results: ProtocolResult[] = [];

for (const definition of definitions) {
  if (!args.protocols.includes(definition.protocol)) continue;
  const keyEnv = environment[definition.key]?.trim()
    ? definition.key
    : defaultKeyEnv;
  const baseUrl = environment[definition.base]?.trim() || defaultBase;
  const model = environment[definition.model]?.trim() || defaultModel;
  const result: ProtocolResult = {
    protocol: definition.protocol,
    status: "ok",
    detail: null,
    model: model ?? null,
    baseUrlOrigin: baseUrl ? originOf(baseUrl) : null,
    samples: [],
  };
  results.push(result);

  if (!keyEnv || !baseUrl || !model) {
    result.status = "unconfigured";
    result.detail = "missing local configuration";
    logger.event("protocol.skip", {
      protocol: definition.protocol,
      reason: result.detail,
    });
    checks.push({
      name: `${definition.protocol} configured`,
      ok: false,
      detail: result.detail,
    });
    continue;
  }

  const adapter = createModelAdapter({
    protocol: definition.protocol,
    baseUrl,
    apiKey: environment[keyEnv] as string,
    maxRetries: 0,
    timeoutMs: 300_000,
    requestStartTimeoutMs: 60_000,
    streamIdleTimeoutMs: 120_000,
  });
  const gateway = new ModelGateway(adapter);

  logger.event("protocol.probe", {
    protocol: definition.protocol,
    model,
    baseUrlOrigin: originOf(baseUrl),
  });

  // 首个 trivial 探针：协议级错误（404/invalid/model_not_found/protocol）
  // 判定为 unsupported，跳过该协议其余矩阵，不让整个基线运行失败。
  const probe = await runScenario(gateway, model, "probe", 0);
  result.samples.push(probe);
  logSample(probe);
  if (!probe.ok) {
    // probe 的错误已序列化，按类别/状态判断是否协议级错误。
    const category = probe.error?.category ?? "unknown";
    const status = probe.error?.status ?? null;
    const protocolLevel =
      status === 404 ||
      ["invalid_request", "model_not_found", "protocol"].includes(category);
    result.status = protocolLevel ? "unsupported" : "probe-error";
    result.detail = probe.error?.message ?? "probe failed";
    logger.event("protocol.skip", {
      protocol: definition.protocol,
      reason: result.status,
      error: probe.error,
    });
    checks.push({
      name: `${definition.protocol} probe`,
      ok: false,
      detail: `${result.status}: ${(probe.error?.message ?? "").slice(0, 160)}`,
    });
    continue;
  }
  checks.push({ name: `${definition.protocol} probe`, ok: true });

  const matrix = [
    "tiny-nonstream",
    "tiny-stream",
    "structured-small",
    "structured-repair",
    "chapter-prompt",
  ];
  for (let runIndex = 1; runIndex <= latencyArgs.runs; runIndex += 1) {
    for (const scenarioName of matrix) {
      const sample = await runScenario(gateway, model, scenarioName, runIndex);
      result.samples.push(sample);
      logSample(sample);
      process.stdout.write(
        `${definition.protocol} ${scenarioName} #${runIndex}: ${sample.ok ? "ok" : "ERROR"} total=${sample.timing?.totalDurationMs ?? "-"}ms ttft=${sample.timing?.timeToFirstTokenMs ?? "-"}ms${sample.mode ? ` mode=${sample.mode} attempts=${sample.attempts}` : ""}\n`,
      );
    }
  }

  // cold-warm：同一 tiny-nonstream 请求连续 3 次，按顺序标记 cold/warm-1/warm-2。
  const coldWarmLabels = ["cold", "warm-1", "warm-2"];
  for (let index = 0; index < coldWarmLabels.length; index += 1) {
    const sample = await runScenario(
      gateway,
      model,
      "tiny-nonstream",
      index + 1,
    );
    sample.scenario = `cold-warm:${coldWarmLabels[index]}`;
    result.samples.push(sample);
    logSample(sample);
  }
}

// ---- 汇总 ----

interface ProtocolSummary {
  status: ProtocolResult["status"];
  detail: string | null;
  model: string | null;
  baseUrlOrigin: string | null;
  scenarios: Record<string, ReturnType<typeof summarizeScenario>>;
  coldWarm: {
    cold: number | null;
    warm1: number | null;
    warm2: number | null;
  } | null;
}

const perProtocol: Record<string, ProtocolSummary> = {};
for (const result of results) {
  const scenarioNames = [
    ...new Set(
      result.samples
        .map((sample) => sample.scenario)
        .filter((name) => name !== "probe"),
    ),
  ];
  const scenarios: Record<string, ReturnType<typeof summarizeScenario>> = {};
  for (const name of scenarioNames) {
    scenarios[name] = summarizeScenario(
      result.samples.filter((sample) => sample.scenario === name),
    );
  }
  const coldWarmSamples = result.samples.filter((sample) =>
    sample.scenario.startsWith("cold-warm:"),
  );
  const coldWarm =
    coldWarmSamples.length === 3
      ? {
          cold:
            coldWarmSamples.find((s) => s.scenario === "cold-warm:cold")?.timing
              ?.totalDurationMs ?? null,
          warm1:
            coldWarmSamples.find((s) => s.scenario === "cold-warm:warm-1")
              ?.timing?.totalDurationMs ?? null,
          warm2:
            coldWarmSamples.find((s) => s.scenario === "cold-warm:warm-2")
              ?.timing?.totalDurationMs ?? null,
        }
      : null;
  perProtocol[result.protocol] = {
    status: result.status,
    detail: result.detail,
    model: result.model,
    baseUrlOrigin: result.baseUrlOrigin,
    scenarios,
    coldWarm,
  };
}

// SLO 候选：共创首 token 取 tiny-stream 的 TTFT；单章估算 = chapter-prompt
// p50 + 2 × structured-small p50（规划/评审各一次结构化调用的粗略组合）。
const sloCandidates: Record<string, unknown> = {};
for (const result of results) {
  if (result.status !== "ok") continue;
  const summary = perProtocol[result.protocol];
  if (!summary) continue;
  const tinyStream = summary.scenarios["tiny-stream"];
  const chapter = summary.scenarios["chapter-prompt"];
  const structuredSmall = summary.scenarios["structured-small"];
  const chapterP50 = chapter?.totalDurationMs.p50 ?? null;
  const structuredP50 = structuredSmall?.totalDurationMs.p50 ?? null;
  sloCandidates[result.protocol] = {
    cocreateFirstTokenMs: {
      p50: tinyStream?.timeToFirstTokenMs.p50 ?? null,
      p95: tinyStream?.timeToFirstTokenMs.p95 ?? null,
    },
    singleChapterEstimateMs:
      chapterP50 !== null && structuredP50 !== null
        ? Math.round(chapterP50 + 2 * structuredP50)
        : null,
    singleChapterComposition:
      "chapter-prompt p50 + 2 × structured-small p50 (plan + review)",
  };
}

const anyOk = results.some((result) => result.status === "ok");

// repair 放大倍数 = structured-repair p50 / structured-small p50（按协议）。
const repairAmplification: Record<string, number | null> = {};
for (const result of results) {
  const summary = perProtocol[result.protocol];
  if (!summary) continue;
  const repairP50 = summary.scenarios["structured-repair"]?.totalDurationMs.p50;
  const smallP50 = summary.scenarios["structured-small"]?.totalDurationMs.p50;
  repairAmplification[result.protocol] =
    repairP50 != null && smallP50 != null && smallP50 > 0
      ? Math.round((repairP50 / smallP50) * 100) / 100
      : null;
}

const latencySummary = {
  scenario,
  gitCommit: currentGitCommit(),
  startedAt,
  finishedAt: new Date().toISOString(),
  runs: latencyArgs.runs,
  chapterPromptChars: CHAPTER_TARGET_CHARS,
  chapterMaxOutputTokens: CHAPTER_MAX_OUTPUT_TOKENS,
  protocols: perProtocol,
  repairAmplification,
  sloCandidates,
};
// 直接写 latency-summary.json，保留基线专用的统计结构。
const latencySummaryPath = join(workspace.dir, "latency-summary.json");
writeFileSync(
  latencySummaryPath,
  `${JSON.stringify(latencySummary, null, 2)}\n`,
  "utf8",
);

logger.event("scenario.end", {
  success: anyOk,
  durationMs: Date.now() - Date.parse(startedAt),
});
writeSmokeSummary({
  workspace,
  scenario,
  protocols: args.protocols,
  startedAt,
  success: anyOk,
  checks,
  extra: { latencySummary: "latency-summary.json" },
});
finalizeSmokeWorkspace(workspace, {
  success: anyOk,
  keepArtifacts: args.keepArtifacts,
});

process.stdout.write(`\nworkspace: ${workspace.dir}\n`);
for (const result of results) {
  process.stdout.write(
    `${result.protocol}: ${result.status}${result.detail ? ` (${result.detail.slice(0, 120)})` : ""}\n`,
  );
}

if (!anyOk) {
  process.stderr.write(
    "\nNo protocol produced latency samples; see summary.json for details.\n",
  );
  process.exitCode = 1;
}
