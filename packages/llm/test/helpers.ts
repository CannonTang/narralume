import type { FetchLike } from "../src/index.js";

export interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
  body: Record<string, unknown>;
}

export function captureFetch(response: Response): {
  fetch: FetchLike;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const rawBody = typeof init?.body === "string" ? init.body : "{}";
    requests.push({
      url,
      init,
      body: JSON.parse(rawBody) as Record<string, unknown>,
    });
    return response.clone();
  };
  return { fetch, requests };
}

export function jsonResponse(
  value: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function sseResponse(
  frames: readonly string[],
  chunkSize = 7,
): Response {
  const bytes = new TextEncoder().encode(frames.join(""));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(
          bytes.slice(offset, Math.min(bytes.length, offset + chunkSize)),
        );
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
  });
}

export function frame(value: unknown, event?: string): string {
  return `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(value)}\n\n`;
}
