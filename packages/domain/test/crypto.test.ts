import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { randomUuid, sha256BytesHex, sha256Hex } from "../src/index.js";

describe("runtime-agnostic crypto", () => {
  it("matches node:crypto sha256 on standard vectors", () => {
    expect(sha256Hex("")).toBe(createHash("sha256").update("").digest("hex"));
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches node:crypto across length boundaries (padding paths)", () => {
    // 55/56/63/64/111/128 字节覆盖 padding 与多块分支；中文字符覆盖多字节编码。
    for (const length of [1, 10, 55, 56, 63, 64, 65, 111, 128, 1000]) {
      const input = (
        "叙灯".repeat(Math.ceil(length / 2)) + "x".repeat(length)
      ).slice(0, length);
      expect(sha256Hex(input)).toBe(
        createHash("sha256").update(input, "utf8").digest("hex"),
      );
    }
  });

  it("hashes raw bytes without UTF-8 re-encoding (sha256BytesHex)", () => {
    // 128-255 区间的字节经 TextEncoder 会被重编码，字节入口必须绕开。
    const bytes = new Uint8Array([104, 105, 128, 200, 255, 0, 42]);
    expect(sha256BytesHex(bytes)).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    const utf8 = new TextEncoder().encode("叙灯hello");
    expect(sha256BytesHex(utf8)).toBe(
      createHash("sha256").update(utf8).digest("hex"),
    );
    expect(sha256Hex("叙灯hello")).toBe(sha256BytesHex(utf8));
  });

  it("produces valid random UUIDs", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const id = randomUuid();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
      seen.add(id);
    }
    expect(seen.size).toBe(100);
  });
});
