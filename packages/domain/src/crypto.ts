/**
 * 运行时无关的散列与随机 ID：同一实现服务 Node 与浏览器（WASM 内核）。
 * sha256 是纯 JS 同步实现——调用点全在同步仓储/工作流代码里，Web Crypto
 * 的异步 digest 无法平替；负载是 KB 级 JSON 与短 ID 串，性能足够。
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(input: string): string {
  return sha256BytesHex(new TextEncoder().encode(input));
}

/** 字节输入（不经 UTF-8 编码）——上传分块/封面等二进制哈希。 */
export function sha256BytesHex(data: Uint8Array): string {
  const bitLength = data.length * 8;
  // padding: 0x80 + zeros + 64-bit big-endian length
  const paddedLength = (((data.length + 8) >> 6) + 1) << 6;
  const block = new Uint8Array(paddedLength);
  block.set(data);
  block[data.length] = 0x80;
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  block[paddedLength - 8] = (high >>> 24) & 0xff;
  block[paddedLength - 7] = (high >>> 16) & 0xff;
  block[paddedLength - 6] = (high >>> 8) & 0xff;
  block[paddedLength - 5] = high & 0xff;
  block[paddedLength - 4] = (low >>> 24) & 0xff;
  block[paddedLength - 3] = (low >>> 16) & 0xff;
  block[paddedLength - 2] = (low >>> 8) & 0xff;
  block[paddedLength - 1] = low & 0xff;

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] =
        (block[j]! << 24) |
        (block[j + 1]! << 16) |
        (block[j + 2]! << 8) |
        block[j + 3]!;
    }
    for (let i = 16; i < 64; i += 1) {
      const prev15 = w[i - 15]!;
      const prev2 = w[i - 2]!;
      const s0 = rotr(prev15, 7) ^ rotr(prev15, 18) ^ (prev15 >>> 3);
      const s1 = rotr(prev2, 17) ^ rotr(prev2, 19) ^ (prev2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!;
    let b = h[1]!;
    let c = h[2]!;
    let d = h[3]!;
    let e = h[4]!;
    let f = h[5]!;
    let g = h[6]!;
    let hh = h[7]!;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  return [...h].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/** 随机 UUID：globalThis.crypto 在 Node 19+ 与所有现代浏览器原生可用。 */
export function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}
