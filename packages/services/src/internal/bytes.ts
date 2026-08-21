import { sha256BytesHex } from "@narralume/domain";

/**
 * 纯 JS 字节工具：Node 与浏览器 Worker 共用，避免 Buffer 依赖。
 * base64 走 btoa/atob（两运行时都原生），sha256 字节哈希先经
 * latin1 字符串桥接（btoa 安全区间）再复用 domain 的同步实现。
 */

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function decodeBase64(source: string): Uint8Array {
  const compact = source.replace(/\s/gu, "");
  if (
    !compact ||
    compact.length % 4 === 1 ||
    /[^A-Za-z0-9+/=]/u.test(compact)
  ) {
    throw new Error("invalid base64");
  }
  const clean = compact.replace(/=+$/u, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (const char of clean) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value < 0) throw new Error("invalid base64 character");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const stride = 32_768;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
  }
  return btoa(binary);
}

export function textToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

export function hashBytes(bytes: Uint8Array): string {
  return sha256BytesHex(bytes);
}
