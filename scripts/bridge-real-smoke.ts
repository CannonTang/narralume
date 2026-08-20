import { buildBridge } from "../apps/bridge/src/app.js";
import { readBridgeConfig } from "../apps/bridge/src/config.js";

const config = readBridgeConfig();
const app = buildBridge({ config, logger: false });
const startedAt = Date.now();

try {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("bridge smoke could not resolve local port");
  }

  const response = await fetch(
    `http://127.0.0.1:${address.port}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-narrative-bridge-token": config.sharedSecret,
      },
      body: JSON.stringify({
        model: "must-be-overridden",
        stream: true,
        max_tokens: 32,
        messages: [{ role: "user", content: "请只回复：连通成功" }],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `bridge smoke returned ${response.status}: ${await response.text()}`,
    );
  }
  if (!response.body) throw new Error("bridge smoke response has no body");

  const reader = response.body.getReader();
  let firstChunkMs: number | null = null;
  let chunks = 0;
  let bytes = 0;
  let containsDone = false;
  const decoder = new TextDecoder();
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    if (firstChunkMs === null) firstChunkMs = Date.now() - startedAt;
    chunks += 1;
    bytes += result.value.byteLength;
    containsDone ||= decoder
      .decode(result.value, { stream: true })
      .includes("[DONE]");
  }
  if (chunks === 0 || bytes === 0 || !containsDone) {
    throw new Error("bridge smoke did not receive a complete SSE stream");
  }
  process.stdout.write(
    JSON.stringify({
      passed: true,
      status: response.status,
      contentType: response.headers.get("content-type"),
      firstChunkMs,
      chunks,
      bytes,
      containsDone,
      totalMs: Date.now() - startedAt,
    }) + "\n",
  );
} finally {
  await app.close();
}
