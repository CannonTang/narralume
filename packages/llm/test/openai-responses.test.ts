import { describe, expect, it } from "vitest";

import { ModelGateway, OpenAIResponsesAdapter } from "../src/index.js";
import { captureFetch, frame, jsonResponse, sseResponse } from "./helpers.js";

describe("OpenAI Responses adapter", () => {
  it("maps tool history and parses message, reasoning, tool, and usage output", async () => {
    const transport = captureFetch(
      jsonResponse({
        id: "resp-1",
        status: "completed",
        output: [
          {
            type: "reasoning",
            summary: [{ type: "summary_text", text: "先检查人物" }],
          },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "城门打开。" }],
          },
          {
            type: "function_call",
            id: "item-1",
            call_id: "call-1",
            name: "record_fact",
            arguments: '{"fact":"城门已开"}',
          },
        ],
        usage: {
          input_tokens: 20,
          output_tokens: 8,
          total_tokens: 28,
          input_tokens_details: { cached_tokens: 5 },
          output_tokens_details: { reasoning_tokens: 2 },
        },
      }),
    );
    const gateway = new ModelGateway(
      new OpenAIResponsesAdapter({
        protocol: "openai-responses",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        fetch: transport.fetch,
      }),
    );
    const response = await gateway.generate({
      model: "writer",
      instructions: "只写可验证的内容",
      reasoningEffort: "low",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              callId: "old-call",
              name: "read_fact",
              arguments: { id: "gate" },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              callId: "old-call",
              name: "read_fact",
              output: { open: false },
            },
          ],
        },
      ],
      tools: [
        {
          name: "record_fact",
          description: "记录候选事实",
          inputSchema: { type: "object" },
        },
      ],
      promptCacheKey: "novel-review",
    });

    expect(response).toMatchObject({
      responseId: "resp-1",
      text: "城门打开。",
      reasoning: "先检查人物",
      finishReason: "tool_calls",
      usage: { cachedInputTokens: 5, reasoningTokens: 2 },
    });
    expect(response.toolCalls[0]).toMatchObject({
      name: "record_fact",
      arguments: { fact: "城门已开" },
    });
    expect(transport.requests[0]?.body).toMatchObject({
      instructions: "只写可验证的内容",
      input: [
        { type: "function_call", call_id: "old-call", name: "read_fact" },
        { type: "function_call_output", call_id: "old-call" },
      ],
      tools: [{ type: "function", name: "record_fact", strict: true }],
      reasoning: { effort: "low" },
      prompt_cache_key: "novel-review",
    });
  });

  it("parses typed streaming events and final usage", async () => {
    const transport = captureFetch(
      sseResponse([
        frame(
          { type: "response.created", response: { id: "resp-2" } },
          "response.created",
        ),
        frame(
          { type: "response.output_text.delta", delta: "潮" },
          "response.output_text.delta",
        ),
        frame(
          {
            type: "response.output_item.added",
            output_index: 1,
            item: {
              type: "function_call",
              id: "item-1",
              call_id: "call-2",
              name: "lookup",
              arguments: "",
            },
          },
          "response.output_item.added",
        ),
        frame(
          {
            type: "response.function_call_arguments.delta",
            item_id: "item-1",
            delta: '{"name":"',
          },
          "response.function_call_arguments.delta",
        ),
        frame(
          {
            type: "response.function_call_arguments.delta",
            item_id: "item-1",
            delta: '潮"}',
          },
          "response.function_call_arguments.delta",
        ),
        frame(
          {
            type: "response.output_item.done",
            item: {
              type: "function_call",
              id: "item-1",
              call_id: "call-2",
              name: "lookup",
              arguments: '{"name":"潮"}',
            },
          },
          "response.output_item.done",
        ),
        frame(
          {
            type: "response.completed",
            response: {
              status: "completed",
              usage: { input_tokens: 3, output_tokens: 4 },
            },
          },
          "response.completed",
        ),
      ]),
    );
    const response = await new ModelGateway(
      new OpenAIResponsesAdapter({
        protocol: "openai-responses",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        fetch: transport.fetch,
      }),
    ).generate(
      { model: "m", messages: [{ role: "user", content: "写" }] },
      { stream: true },
    );

    expect(response.text).toBe("潮");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0]?.arguments).toEqual({ name: "潮" });
    expect(response.usage.totalTokens).toBe(7);
    expect(response.finishReason).toBe("tool_calls");
  });

  it("recovers text from done and completed events used by compatible gateways", async () => {
    const transport = captureFetch(
      sseResponse([
        frame(
          { type: "response.created", response: { id: "resp-compat" } },
          "response.created",
        ),
        frame(
          { type: "response.output_text.done", text: "兼容文本" },
          "response.output_text.done",
        ),
        frame(
          {
            type: "response.completed",
            response: {
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "兼容文本" }],
                },
              ],
              usage: { input_tokens: 2, output_tokens: 3 },
            },
          },
          "response.completed",
        ),
      ]),
    );
    const response = await new ModelGateway(
      new OpenAIResponsesAdapter({
        protocol: "openai-responses",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        fetch: transport.fetch,
      }),
    ).generate(
      { model: "m", messages: [{ role: "user", content: "写" }] },
      { stream: true },
    );

    expect(response.text).toBe("兼容文本");
  });

  it("uses text.format json_object with a JSON instruction hint in json-mode", async () => {
    const transport = captureFetch(
      jsonResponse({
        id: "resp-json",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: '{"ok":true}' }],
          },
        ],
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      }),
    );
    const gateway = new ModelGateway(
      new OpenAIResponsesAdapter({
        protocol: "openai-responses",
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
    expect(transport.requests[0]?.body.text).toEqual({
      format: { type: "json_object" },
    });
    expect(transport.requests[0]?.body.instructions).toBe(
      "Respond with a single JSON object.",
    );
  });
});
