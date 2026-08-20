import { describe, expect, it } from "vitest";

import { ModelGateway, OpenAIChatAdapter } from "../src/index.js";
import { captureFetch, frame, jsonResponse, sseResponse } from "./helpers.js";

describe("OpenAI Chat Completions adapter", () => {
  it("maps instructions, tools, schema, usage, and non-stream output", async () => {
    const transport = captureFetch(
      jsonResponse({
        id: "chatcmpl-1",
        choices: [{ message: { content: "灯亮了" }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 4,
          total_tokens: 16,
          prompt_tokens_details: { cached_tokens: 3 },
          completion_tokens_details: { reasoning_tokens: 1 },
        },
      }),
    );
    const gateway = new ModelGateway(
      new OpenAIChatAdapter({
        protocol: "openai-chat",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        fetch: transport.fetch,
      }),
    );
    const response = await gateway.generate({
      model: "writer",
      instructions: "你是作家",
      messages: [{ role: "user", content: "继续" }],
      tools: [
        {
          name: "read_canon",
          description: "读取正典",
          inputSchema: { type: "object" },
        },
      ],
      responseSchema: {
        name: "chapter",
        schema: { type: "object", properties: { text: { type: "string" } } },
      },
      maxOutputTokens: 1_000,
      reasoningEffort: "low",
      promptCacheKey: "novel-chapter",
    });

    expect(response).toMatchObject({
      responseId: "chatcmpl-1",
      text: "灯亮了",
      finishReason: "stop",
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        cachedInputTokens: 3,
        reasoningTokens: 1,
      },
    });
    const request = transport.requests[0];
    expect(request?.url).toBe("https://api.example.com/v1/chat/completions");
    expect(new Headers(request?.init?.headers).get("authorization")).toBe(
      "Bearer secret",
    );
    expect(request?.body).toMatchObject({
      model: "writer",
      stream: false,
      max_tokens: 1_000,
      reasoning_effort: "low",
      prompt_cache_key: "novel-chapter",
      messages: [
        { role: "system", content: "你是作家" },
        { role: "user", content: "继续" },
      ],
      tool_choice: "auto",
      response_format: { type: "json_schema" },
    });
  });

  it("assembles streamed Chinese text and chunked parallel tool arguments", async () => {
    const transport = captureFetch(
      sseResponse(
        [
          frame({
            id: "chat-2",
            choices: [{ delta: { content: "灯" }, finish_reason: null }],
          }),
          frame({
            id: "chat-2",
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-1",
                      function: { name: "read_canon", arguments: '{"id":' },
                    },
                    {
                      index: 1,
                      id: "call-2",
                      function: {
                        name: "read_timeline",
                        arguments: '{"chapter":',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          }),
          frame({
            id: "chat-2",
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: '"hero"}' } },
                    { index: 1, function: { arguments: "7}" } },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }),
          frame({
            id: "chat-2",
            choices: [],
            usage: { prompt_tokens: 9, completion_tokens: 5 },
          }),
          "data: [DONE]\n\n",
        ],
        1,
      ),
    );
    const gateway = new ModelGateway(
      new OpenAIChatAdapter({
        protocol: "openai-chat",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        fetch: transport.fetch,
      }),
    );

    const response = await gateway.generate(
      { model: "writer", messages: [{ role: "user", content: "继续" }] },
      { stream: true },
    );
    expect(response.text).toBe("灯");
    expect(response.finishReason).toBe("tool_calls");
    expect(response.toolCalls).toEqual([
      expect.objectContaining({
        callId: "call-1",
        name: "read_canon",
        arguments: { id: "hero" },
      }),
      expect.objectContaining({
        callId: "call-2",
        name: "read_timeline",
        arguments: { chapter: 7 },
      }),
    ]);
    expect(response.usage.totalTokens).toBe(14);
  });

  it("uses json_object with a minimal JSON system hint in json-mode", async () => {
    const transport = captureFetch(
      jsonResponse({
        id: "chatcmpl-json",
        choices: [
          { message: { content: '{"ok":true}' }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }),
    );
    const gateway = new ModelGateway(
      new OpenAIChatAdapter({
        protocol: "openai-chat",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        fetch: transport.fetch,
      }),
    );
    expect(gateway.supportsStructuredMode("json-mode")).toBe(true);

    await gateway.generate({
      model: "writer",
      messages: [{ role: "user", content: "return ok" }],
      responseSchema: { name: "probe", schema: { type: "object" } },
      structuredMode: "json-mode",
    });
    expect(transport.requests[0]?.body.response_format).toEqual({
      type: "json_object",
    });
    expect(transport.requests[0]?.body.messages).toEqual([
      { role: "system", content: "Respond with a single JSON object." },
      { role: "user", content: "return ok" },
    ]);

    // No extra hint when the request already mentions JSON.
    await gateway.generate({
      model: "writer",
      instructions: "Reply in JSON.",
      messages: [{ role: "user", content: "return ok" }],
      responseSchema: { name: "probe", schema: { type: "object" } },
      structuredMode: "json-mode",
    });
    expect(transport.requests[1]?.body.response_format).toEqual({
      type: "json_object",
    });
    expect(transport.requests[1]?.body.messages).toEqual([
      { role: "system", content: "Reply in JSON." },
      { role: "user", content: "return ok" },
    ]);
  });
});
