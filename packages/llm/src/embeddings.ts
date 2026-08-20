import { ModelError } from "./error.js";
import { postJson, readJsonObject } from "./transport.js";
import type { AdapterConfig, NormalizedUsage } from "./types.js";

export interface EmbeddingGenerationResult {
  vectors: number[][];
  usage: NormalizedUsage;
}

export async function generateOpenAIEmbeddings(
  config: AdapterConfig,
  model: string,
  inputs: readonly string[],
  signal?: AbortSignal,
): Promise<EmbeddingGenerationResult> {
  if (inputs.length === 0 || inputs.length > 128)
    throw new ModelError("Embedding input count must be between 1 and 128", {
      category: "invalid_request",
    });
  const { endpoint: _ignoredEndpoint, ...embeddingConfig } = config;
  void _ignoredEndpoint;
  const { response } = await postJson(
    embeddingConfig,
    "embeddings",
    { model, input: inputs, encoding_format: "float" },
    {
      ...(signal ? { signal } : {}),
      headers: { authorization: `Bearer ${config.apiKey}` },
    },
  );
  const body = await readJsonObject(response);
  if (!Array.isArray(body.data))
    throw new ModelError("Embedding response is missing data", {
      category: "protocol",
    });
  const vectors = body.data
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return null;
      const record = entry as Record<string, unknown>;
      if (!Array.isArray(record.embedding)) return null;
      const vector = record.embedding.filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value),
      );
      return {
        index: typeof record.index === "number" ? record.index : 0,
        vector,
      };
    })
    .filter((entry): entry is { index: number; vector: number[] } =>
      Boolean(entry && entry.vector.length > 0),
    )
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.vector);
  if (vectors.length !== inputs.length)
    throw new ModelError(
      "Embedding response count does not match input count",
      {
        category: "protocol",
      },
    );
  const usage =
    body.usage && typeof body.usage === "object" && !Array.isArray(body.usage)
      ? (body.usage as Record<string, unknown>)
      : {};
  const inputTokens = numberOrZero(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.total_tokens,
  );
  return {
    vectors,
    usage: {
      inputTokens,
      outputTokens: 0,
      totalTokens: numberOrZero(usage.total_tokens) || inputTokens,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    },
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}
