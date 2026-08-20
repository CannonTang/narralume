import { AnthropicMessagesAdapter } from "./adapters/anthropic-messages.js";
import { OpenAIChatAdapter } from "./adapters/openai-chat.js";
import { OpenAIResponsesAdapter } from "./adapters/openai-responses.js";
import type { AdapterConfig, ModelAdapter } from "./types.js";

export * from "./error.js";
export * from "./embeddings.js";
export * from "./gateway.js";
export * from "./sse.js";
export * from "./structured.js";
export * from "./timing.js";
export * from "./transport.js";
export * from "./types.js";

export { AnthropicMessagesAdapter, OpenAIChatAdapter, OpenAIResponsesAdapter };

export function createModelAdapter(config: AdapterConfig): ModelAdapter {
  switch (config.protocol) {
    case "openai-chat":
      return new OpenAIChatAdapter(config);
    case "openai-responses":
      return new OpenAIResponsesAdapter(config);
    case "anthropic-messages":
      return new AnthropicMessagesAdapter(config);
  }
}
