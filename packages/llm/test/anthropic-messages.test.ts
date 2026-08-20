import { describe, expect, it } from "vitest";

import { AnthropicMessagesAdapter, ModelGateway } from "../src/index.js";
import { captureFetch, frame, jsonResponse, sseResponse } from "./helpers.js";

describe("Anthropic Messages adapter", () => {
  it("maps system/tool history/schema and parses non-stream content blocks", async () => {
    const transport = captureFetch(
      jsonResponse({
        id: "msg-1",
        type: "message",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "检查时间线" },
          { type: "text", text: "雨停了。" },
          {
            type: "tool_use",
            id: "tool-1",
            name: "read_timeline",
            input: { chapter: 3 },
          },
        ],
        stop_reason: "tool_use",
        usage: {
          input_tokens: 15,
          output_tokens: 6,
          cache_read_input_tokens: 4,
        },
      }),
    );
    const response = await new ModelGateway(
      new AnthropicMessagesAdapter({
        protocol: "anthropic-messages",
        baseUrl: "https://api.anthropic.example/v1",
        apiKey: "secret",
        fetch: transport.fetch,
      }),
    ).generate({
      model: "claude-writer",
      instructions: "你是作家",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              callId: "old-1",
              name: "read",
              arguments: { id: 1 },
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              callId: "old-1",
              output: { title: "第一章" },
            },
          ],
        },
      ],
      tools: [
        {
          name: "read_timeline",
          description: "读取时间线",
          inputSchema: { type: "object" },
        },
      ],
      responseSchema: { name: "review", schema: { type: "object" } },
      reasoningEffort: "low",
      cacheControl: { type: "ephemeral", ttl: "1h" },
    });

    expect(response).toMatchObject({
      responseId: "msg-1",
      text: "雨停了。",
      reasoning: "检查时间线",
      finishReason: "tool_calls",
      usage: {
        inputTokens: 19,
        outputTokens: 6,
        totalTokens: 25,
        cachedInputTokens: 4,
      },
    });
    expect(response.toolCalls[0]?.arguments).toEqual({ chapter: 3 });
    const request = transport.requests[0];
    expect(request?.url).toBe("https://api.anthropic.example/v1/messages");
    expect(new Headers(request?.init?.headers).get("x-api-key")).toBe("secret");
    expect(request?.body).toMatchObject({
      system: [
        {
          type: "text",
          text: "你是作家",
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      tool_choice: { type: "auto" },
      output_config: {
        effort: "low",
        format: { type: "json_schema" },
      },
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "old-1" }] },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "old-1" }],
        },
      ],
    });
  });

  it("assembles Anthropic content block streams and token usage", async () => {
    const transport = captureFetch(
      sseResponse(
        [
          frame(
            {
              type: "message_start",
              message: {
                id: "msg-2",
                usage: { input_tokens: 11, cache_creation_input_tokens: 2 },
              },
            },
            "message_start",
          ),
          frame(
            {
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            },
            "content_block_start",
          ),
          frame(
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "雾" },
            },
            "content_block_delta",
          ),
          frame(
            {
              type: "content_block_start",
              index: 1,
              content_block: {
                type: "tool_use",
                id: "tool-2",
                name: "lookup",
                input: {},
              },
            },
            "content_block_start",
          ),
          frame(
            {
              type: "content_block_delta",
              index: 1,
              delta: { type: "input_json_delta", partial_json: '{"place":' },
            },
            "content_block_delta",
          ),
          frame(
            {
              type: "content_block_delta",
              index: 1,
              delta: { type: "input_json_delta", partial_json: '"港口"}' },
            },
            "content_block_delta",
          ),
          frame({ type: "content_block_stop", index: 1 }, "content_block_stop"),
          frame(
            {
              type: "message_delta",
              delta: { stop_reason: "tool_use" },
              usage: { output_tokens: 7 },
            },
            "message_delta",
          ),
          frame({ type: "message_stop" }, "message_stop"),
        ],
        2,
      ),
    );
    const response = await new ModelGateway(
      new AnthropicMessagesAdapter({
        protocol: "anthropic-messages",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        fetch: transport.fetch,
      }),
    ).generate(
      { model: "m", messages: [{ role: "user", content: "写" }] },
      { stream: true },
    );

    expect(response.text).toBe("雾");
    expect(response.toolCalls[0]).toMatchObject({
      callId: "tool-2",
      name: "lookup",
      arguments: { place: "港口" },
    });
    expect(response.usage).toMatchObject({
      inputTokens: 13,
      outputTokens: 7,
      totalTokens: 20,
      cachedInputTokens: 2,
    });
  });

  it("reports json-mode unsupported and degrades a direct json-mode request", async () => {
    const transport = captureFetch(
      jsonResponse({
        id: "msg-json",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: '{"ok":true}' }],
        stop_reason: "end_turn",
        usage: { input_tokens: 3, output_tokens: 2 },
      }),
    );
    const gateway = new ModelGateway(
      new AnthropicMessagesAdapter({
        protocol: "anthropic-messages",
        baseUrl: "https://api.example.com/v1",
        apiKey: "secret",
        fetch: transport.fetch,
      }),
    );
    expect(gateway.supportsStructuredMode("json-mode")).toBe(false);
    expect(gateway.supportsStructuredMode("native")).toBe(true);

    // A direct json-mode request is not an error: it degrades to a plain
    // call without output_config.format.
    await gateway.generate({
      model: "claude-writer",
      messages: [{ role: "user", content: "return ok" }],
      responseSchema: { name: "probe", schema: { type: "object" } },
      structuredMode: "json-mode",
    });
    expect(transport.requests[0]?.body.output_config).toBeUndefined();
  });
});
