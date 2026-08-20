const CJK =
  /[\u2e80-\u2fff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;
const ASCII_WORD = /[A-Za-z0-9_]+/gu;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = "";
  for (const character of text) {
    if (CJK.test(character)) cjk += 1;
    else other += character;
  }
  const words = other.match(ASCII_WORD) ?? [];
  const wordTokens = words.reduce(
    (total, word) => total + Math.max(1, Math.ceil(word.length / 4)),
    0,
  );
  const punctuationAndWhitespace = other.replace(ASCII_WORD, "").trim().length;
  return Math.max(
    1,
    cjk + wordTokens + Math.ceil(punctuationAndWhitespace / 3),
  );
}
