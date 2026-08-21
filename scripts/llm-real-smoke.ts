import { resolve } from "node:path";

import { config as loadDotEnv } from "dotenv";

import {
  testModelConnection,
  type ConnectionTestProfile,
} from "@narralume/services";
import { scrubSecrets } from "@narralume/llm";

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

const scenario = "llm-real";
const args = parseRealSmokeArgs(process.argv.slice(2), {
  script: "llm-real-smoke.ts",
  defaultProtocols: ["openai-chat", "openai-responses", "anthropic-messages"],
});
const workspace = createSmokeWorkspace(scenario, { outputDir: args.outputDir });
const logger = new SmokeLogger(workspace.jsonlPath, scenario, {
  diagnostic: args.diagnostic,
});
installSignalFlush(logger);
const startedAt = new Date().toISOString();
const checks: SmokeCheck[] = [];
const targets: Array<{
  protocol: string;
  modelConfigId: string;
  model: string;
  baseUrlOrigin: string;
}> = [];

const environment = process.env;
const selected = new Set(args.protocols);
const definitions = [
  {
    protocol: "openai-chat" as const,
    key: "NARRATIVE_CHAT_API_KEY",
    base: "NARRATIVE_CHAT_BASE_URL",
    model: "NARRATIVE_CHAT_MODEL",
  },
  {
    protocol: "openai-responses" as const,
    key: "NARRATIVE_RESPONSES_API_KEY",
    base: "NARRATIVE_RESPONSES_BASE_URL",
    model: "NARRATIVE_RESPONSES_MODEL",
  },
  {
    protocol: "anthropic-messages" as const,
    key: "NARRATIVE_ANTHROPIC_API_KEY",
    base: "NARRATIVE_ANTHROPIC_BASE_URL",
    model: "NARRATIVE_ANTHROPIC_MODEL",
  },
];

const defaultKeyEnv = findKeyEnvironment(["NARRATIVE_LLM_API_KEY"]);
const defaultBase = findValue(["NARRATIVE_LLM_BASE_URL"]);
const defaultModel = findValue(["NARRATIVE_LLM_MODEL"]);

logger.event("scenario.start", {
  protocols: args.protocols,
  workspace: workspace.dir,
  gitCommit: currentGitCommit(),
});

let failed = false;
for (const definition of definitions) {
  if (selected.size > 0 && !selected.has(definition.protocol)) continue;
  const keyEnv = environment[definition.key]?.trim()
    ? definition.key
    : defaultKeyEnv;
  const baseUrl = environment[definition.base]?.trim() || defaultBase;
  const model = environment[definition.model]?.trim() || defaultModel;
  if (!keyEnv || !baseUrl || !model) {
    process.stdout.write(
      `${definition.protocol}: SKIPPED (missing local configuration)\n`,
    );
    checks.push({
      name: `${definition.protocol} configured`,
      ok: false,
      detail: "missing local configuration",
    });
    failed = true;
    continue;
  }

  const target: ConnectionTestProfile = {
    id: `smoke-${definition.protocol}`,
    name: definition.protocol,
    protocol: definition.protocol,
    baseUrl,
    endpoint: null,
    model,
    apiKeyEnv: keyEnv,
    anthropicVersion: null,
    extraHeaders: {},
    capabilities: {},
  };
  logger.event("model.resolved", {
    modelConfigId: target.id,
    protocol: target.protocol,
    model: target.model,
    baseUrlOrigin: originOf(target.baseUrl),
  });
  targets.push({
    modelConfigId: target.id,
    protocol: target.protocol,
    model: target.model,
    baseUrlOrigin: originOf(target.baseUrl),
  });

  process.stdout.write(`\n${definition.protocol}\n`);
  const stages = await testModelConnection(
    target,
    {
      includeStreaming: true,
      includeTools: true,
      includeStructuredOutput: true,
    },
    environment,
  );
  for (const stage of stages) {
    const marker =
      stage.status === "passed" ? "PASS" : stage.status.toUpperCase();
    process.stdout.write(
      `  ${marker.padEnd(7)} ${stage.stage.padEnd(18)} ${String(stage.latencyMs).padStart(6)} ms  ${scrubSecrets(stage.detail)}\n`,
    );
    logger.event("probe.stage", {
      protocol: definition.protocol,
      stage: stage.stage,
      status: stage.status,
      latencyMs: stage.latencyMs,
      detail: stage.detail,
    });
    checks.push({
      name: `${definition.protocol} ${stage.stage}`,
      ok: stage.status === "passed",
      detail: scrubSecrets(stage.detail).slice(0, 200),
    });
    if (stage.status !== "passed") failed = true;
  }
}

logger.event("scenario.end", {
  success: !failed,
  durationMs: Date.now() - Date.parse(startedAt),
});
writeSmokeSummary({
  workspace,
  scenario,
  protocols: args.protocols,
  startedAt,
  success: !failed,
  checks,
  extra: { targets },
});
finalizeSmokeWorkspace(workspace, {
  success: !failed,
  keepArtifacts: args.keepArtifacts,
});

if (failed) {
  process.stderr.write(
    "\nOne or more required real-API capability probes did not pass.\n",
  );
  process.exitCode = 1;
} else {
  process.stdout.write("\nAll configured protocol capability probes passed.\n");
}

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
