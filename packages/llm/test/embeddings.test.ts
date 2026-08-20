import { describe, expect, it, vi } from "vitest";

import { generateOpenAIEmbeddings } from "../src/embeddings.js";

describe("generateOpenAIEmbeddings", () => {
  it("normalizes the OpenAI-compatible embeddings response", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { index: 1, embedding: [0, 1, 0] },
              { index: 0, embedding: [1, 0, 0] },
            ],
            usage: { prompt_tokens: 7, total_tokens: 7 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const result = await generateOpenAIEmbeddings(
      {
        protocol: "openai-responses",
        baseUrl: "https://models.example/v1",
        apiKey: "secret",
        fetch: fetcher,
      },
      "embedding-model",
      ["first", "second"],
    );
    expect(result).toEqual({
      vectors: [
        [1, 0, 0],
        [0, 1, 0],
      ],
      usage: {
        inputTokens: 7,
        outputTokens: 0,
        totalTokens: 7,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
    });
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://models.example/v1/embeddings",
    );
  });
});
