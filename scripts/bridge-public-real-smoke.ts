import { config as loadDotEnv } from "dotenv";

loadDotEnv({ path: "apps/relay/.env.local", quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name} in apps/relay/.env.local`);
  return value;
}

const startedAt = Date.now();
const response = await fetch(
  new URL(
    "chat/completions",
    `${required("PUBLIC_BRIDGE_URL").replace(/\/+$/u, "")}/`,
  ).toString(),
  {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json",
      "cf-access-client-id": required("BRIDGE_ACCESS_CLIENT_ID"),
      "cf-access-client-secret": required("BRIDGE_ACCESS_CLIENT_SECRET"),
      "x-narrative-bridge-token": required("BRIDGE_SHARED_SECRET"),
    },
    body: JSON.stringify({
      model: "must-be-overridden",
      stream: true,
      max_tokens: 32,
      messages: [{ role: "user", content: "请只回复：公网连通成功" }],
    }),
  },
);

if (!response.ok) {
  throw new Error(`public bridge smoke returned HTTP ${response.status}`);
}
if (!response.body) throw new Error("public bridge smoke response has no body");

const reader = response.body.getReader();
const decoder = new TextDecoder();
let firstChunkMs: number | null = null;
let chunks = 0;
let bytes = 0;
let streamTail = "";
while (true) {
  const result = await reader.read();
  if (result.done) break;
  if (firstChunkMs === null) firstChunkMs = Date.now() - startedAt;
  chunks += 1;
  bytes += result.value.byteLength;
  streamTail = (
    streamTail + decoder.decode(result.value, { stream: true })
  ).slice(-128);
}

const containsDone = streamTail.includes("[DONE]");
if (chunks === 0 || bytes === 0 || !containsDone) {
  throw new Error("public bridge smoke did not receive a complete SSE stream");
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
