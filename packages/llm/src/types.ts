export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonSchema = Record<string, unknown>;

export type ModelProtocol =
  "openai-chat" | "openai-responses" | "anthropic-messages";
export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolCallContent {
  type: "tool-call";
  callId: string;
  name: string;
  arguments: JsonValue;
}

export interface ToolResultContent {
  type: "tool-result";
  callId: string;
  name?: string;
  output: JsonValue | string;
  isError?: boolean;
}

export type ModelContent = TextContent | ToolCallContent | ToolResultContent;

export interface ModelMessage {
  role: MessageRole;
  content: string | readonly ModelContent[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  strict?: boolean;
}

export type ToolChoice = "auto" | "none" | "required" | { name: string };

export interface JsonSchemaContract {
  name: string;
  description?: string;
  schema: JsonSchema;
  strict?: boolean;
}

/**
 * Structured-output tier a request asks the adapter to use.
 * - "native": provider-native schema enforcement (json_schema).
 * - "json-mode": provider JSON mode (json_object); format only, no schema.
 * - "prompt": no response format at all; the schema lives in the prompt.
 * Absent means "native" when a responseSchema is present.
 */
export type StructuredMode = "native" | "json-mode" | "prompt";

/** Pipeline attempt kinds reported by generateStructured. */
export type StructuredAttemptMode = StructuredMode | "repair";

export interface ModelRequest {
  model: string;
  instructions?: string;
  messages: readonly ModelMessage[];
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  tools?: readonly ToolDefinition[];
  toolChoice?: ToolChoice;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  responseSchema?: JsonSchemaContract;
  structuredMode?: StructuredMode;
  stopSequences?: readonly string[];
  metadata?: Readonly<Record<string, string>>;
  promptCacheKey?: string;
  cacheControl?: { type: "ephemeral"; ttl?: "5m" | "1h" };
}

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
}

export type FinishReason =
  | "stop"
  | "length"
  | "context_length"
  | "tool_calls"
  | "content_filter"
  | "cancelled"
  | "error"
  | "unknown";

export interface ToolCall {
  callId: string;
  name: string;
  arguments: JsonValue;
  rawArguments: string;
}

/**
 * Latency breakdown for one logical model call. Timestamps are epoch ms;
 * the derived durations are computed from them. All fields after
 * `dispatchedAt` are absent when the call did not reach that phase.
 */
export interface ModelCallTiming {
  dispatchedAt: number;
  headersAt?: number;
  firstEventAt?: number;
  lastEventAt?: number;
  finishedAt?: number;
  timeToHeadersMs?: number;
  timeToFirstTokenMs?: number;
  streamActiveMs?: number;
  totalDurationMs?: number;
}

export type ModelEvent =
  | {
      type: "response.started";
      responseId?: string;
      timeToHeadersMs?: number;
      timeToFirstTokenMs?: number;
    }
  | { type: "text.delta"; text: string }
  | { type: "reasoning.delta"; text: string }
  | { type: "tool.started"; callId: string; name: string }
  | { type: "tool.arguments.delta"; callId: string; json: string }
  | { type: "tool.completed"; call: ToolCall }
  | { type: "usage"; usage: NormalizedUsage }
  | {
      type: "response.completed";
      finishReason: FinishReason;
      timing?: ModelCallTiming;
      requestId?: string;
    }
  | {
      type: "structured.attempt";
      attempt: number;
      mode: StructuredAttemptMode;
      valid: boolean;
      issues?: readonly string[];
    }
  | { type: "error"; error: SerializedModelError };

export interface SerializedModelError {
  category: ModelErrorCategory;
  message: string;
  retryable: boolean;
  /** Stable machine-readable reason, e.g. "request_start_timeout". */
  code?: string;
  status?: number;
  requestId?: string;
  retryAfterMs?: number;
  partialText?: string;
  timing?: ModelCallTiming;
}

export type ModelErrorCategory =
  | "authentication"
  | "permission"
  | "rate_limit"
  | "context_length"
  | "invalid_request"
  | "model_not_found"
  | "content_filter"
  | "timeout"
  | "network"
  | "server"
  | "stream_interrupted"
  | "protocol"
  | "cancelled";

export interface ModelResponse {
  responseId?: string;
  text: string;
  reasoning: string;
  toolCalls: readonly ToolCall[];
  usage: NormalizedUsage;
  finishReason: FinishReason;
  timing?: ModelCallTiming;
  requestId?: string;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface AdapterConfig {
  protocol: ModelProtocol;
  baseUrl: string;
  apiKey: string;
  endpoint?: string;
  headers?: Readonly<Record<string, string>>;
  /** Provider-specific query parameters appended to the resolved endpoint. */
  queryParams?: Readonly<Record<string, string>>;
  anthropicVersion?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  /**
   * Time budget (ms) from dispatch to response headers for one attempt.
   * Exceeding it aborts the attempt with a retryable `request_start_timeout`
   * error.
   */
  requestStartTimeoutMs?: number;
  /**
   * Idle budget (ms) between streamed events. Exceeding it aborts the stream
   * with a retryable `stream_idle_timeout` error.
   */
  streamIdleTimeoutMs?: number;
  /**
   * Wall-clock deadline (ms) for one logical call across physical attempts.
   * Carried on the config for the Harness retry owner; postJson does not
   * enforce it.
   */
  logicalCallDeadlineMs?: number;
  /** Called immediately before each physical HTTP request is dispatched. */
  onRequestAttempt?: (attempt: number) => void;
  fetch?: FetchLike;
}

export interface StreamOptions {
  signal?: AbortSignal;
  stream?: boolean;
}

export interface ModelAdapter {
  readonly protocol: ModelProtocol;
  /**
   * Reports whether the adapter can serve a structured-output tier.
   * Adapters that omit this are assumed to support "native" and "prompt"
   * but not "json-mode".
   */
  supportsStructuredMode?(mode: StructuredMode): boolean;
  stream(
    request: ModelRequest,
    options?: StreamOptions,
  ): AsyncIterable<ModelEvent>;
}

export const EMPTY_USAGE: NormalizedUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
});
