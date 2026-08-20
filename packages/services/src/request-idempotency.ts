import { sha256Hex } from "./internal/crypto.js";

export function hashRequest(value: unknown): string {
  return sha256Hex(stableJson(value));
}

/** 把任意种子串映射为稳定的 UUID 形状（v4 段位伪装，仅作全局唯一 ID）。 */
export function deterministicUuid(seed: string): string {
  const hex = sha256Hex(seed);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function deterministicRequestId(
  kind: string,
  scopeId: string,
  requestId: string,
): string {
  return deterministicUuid(`${kind}\0${scopeId}\0${requestId}`);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(",")}}`;
}
