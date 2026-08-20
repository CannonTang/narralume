import {
  SqliteAssignmentRepository,
  SqliteModelRepository,
  SqliteProviderRepository,
  type NarrativeDatabase,
} from "@narrative-lantern/persistence";

import { resolveProviderDefaults } from "./provider-defaults.js";

/**
 * Seeds the providers/models/model_assignments tables from environment
 * variables. Environment rows are ordinary provider/model records with
 * stable ids. Credentials are stored as `env:NAME` references; raw keys never
 * reach the database. Physical model limits are optional metadata; when they
 * are unknown, runtime policy supplies conservative work budgets.
 */
export function seedEnvironmentModelConfig(
  database: NarrativeDatabase,
  environment: Readonly<Record<string, string | undefined>> = {},
  now = new Date().toISOString(),
): void {
  const providers = new SqliteProviderRepository(database);
  const models = new SqliteModelRepository(database);
  const assignments = new SqliteAssignmentRepository(database);
  const defaults = resolveProviderDefaults(environment);
  const definitions = [
    {
      id: "environment-chat",
      name: "环境 · Chat Completions",
      wireApi: "openai-chat" as const,
      keyEnv: "NARRATIVE_CHAT_API_KEY",
      baseEnv: "NARRATIVE_CHAT_BASE_URL",
      modelEnv: "NARRATIVE_CHAT_MODEL",
      contextEnv: "NARRATIVE_CHAT_CONTEXT_WINDOW",
      outputEnv: "NARRATIVE_CHAT_MAX_OUTPUT_TOKENS",
    },
    {
      id: "environment-responses",
      name: "环境 · Responses",
      wireApi: "openai-responses" as const,
      keyEnv: "NARRATIVE_RESPONSES_API_KEY",
      baseEnv: "NARRATIVE_RESPONSES_BASE_URL",
      modelEnv: "NARRATIVE_RESPONSES_MODEL",
      contextEnv: "NARRATIVE_RESPONSES_CONTEXT_WINDOW",
      outputEnv: "NARRATIVE_RESPONSES_MAX_OUTPUT_TOKENS",
    },
    {
      id: "environment-anthropic",
      name: "环境 · Anthropic Messages",
      wireApi: "anthropic-messages" as const,
      keyEnv: "NARRATIVE_ANTHROPIC_API_KEY",
      baseEnv: "NARRATIVE_ANTHROPIC_BASE_URL",
      modelEnv: "NARRATIVE_ANTHROPIC_MODEL",
      contextEnv: "NARRATIVE_ANTHROPIC_CONTEXT_WINDOW",
      outputEnv: "NARRATIVE_ANTHROPIC_MAX_OUTPUT_TOKENS",
    },
  ];

  let firstEnvironmentModelId: string | null = null;
  for (const definition of definitions) {
    const apiKeyEnv = environment[definition.keyEnv]?.trim()
      ? definition.keyEnv
      : defaults.apiKeyEnv;
    const baseUrl = environment[definition.baseEnv]?.trim() || defaults.baseUrl;
    const model = environment[definition.modelEnv]?.trim() || defaults.model;
    if (!apiKeyEnv || !baseUrl || !model) continue;

    const existingProvider = providers.get(definition.id);
    providers.upsert({
      id: definition.id,
      name: definition.name,
      wireApi: definition.wireApi,
      baseUrl,
      endpoint: existingProvider?.endpoint ?? null,
      credentialRef: `env:${apiKeyEnv}`,
      anthropicVersion: existingProvider?.anthropicVersion ?? null,
      headers: existingProvider?.headers ?? {},
      queryParams: existingProvider?.queryParams ?? {},
      requestStartTimeoutMs: existingProvider?.requestStartTimeoutMs ?? null,
      streamIdleTimeoutMs: existingProvider?.streamIdleTimeoutMs ?? null,
      enabled: existingProvider?.enabled ?? true,
      createdAt: existingProvider?.createdAt ?? now,
      updatedAt: now,
    });
    const existingModel = models.get(definition.id);
    const hasEnvironmentContext = Boolean(
      environment[definition.contextEnv]?.trim() ||
      environment.NARRATIVE_LLM_CONTEXT_WINDOW?.trim(),
    );
    const hasEnvironmentOutput = Boolean(
      environment[definition.outputEnv]?.trim() ||
      environment.NARRATIVE_LLM_MAX_OUTPUT_TOKENS?.trim(),
    );
    const contextWindow =
      positiveEnvironmentInteger(environment[definition.contextEnv]) ??
      positiveEnvironmentInteger(environment.NARRATIVE_LLM_CONTEXT_WINDOW) ??
      existingModel?.contextWindow ??
      null;
    const maxOutputTokens =
      positiveEnvironmentInteger(environment[definition.outputEnv]) ??
      positiveEnvironmentInteger(environment.NARRATIVE_LLM_MAX_OUTPUT_TOKENS) ??
      existingModel?.maxOutputTokens ??
      null;
    models.upsert({
      id: definition.id,
      providerId: definition.id,
      modelId: model,
      taskType: "writing",
      contextWindow,
      maxOutputTokens,
      sampling: existingModel?.sampling ?? {},
      // An unprobed capability is unknown, not false. Only the explicit
      // connection probe may persist negative capability evidence.
      capabilities: existingModel?.capabilities ?? {},
      metadataSource: "environment",
      metadataVerifiedAt:
        hasEnvironmentContext && hasEnvironmentOutput
          ? now
          : (existingModel?.metadataVerifiedAt ?? null),
      enabled: existingModel?.enabled ?? true,
      createdAt: existingModel?.createdAt ?? now,
      updatedAt: now,
    });
    firstEnvironmentModelId ??= definition.id;
  }

  // Ensure the default writing assignment points at the first available
  // environment model; an existing assignment (user-set or migrated) is
  // left untouched.
  if (firstEnvironmentModelId && !assignments.get("writing")) {
    assignments.set("writing", firstEnvironmentModelId, now);
  }
}

function positiveEnvironmentInteger(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
