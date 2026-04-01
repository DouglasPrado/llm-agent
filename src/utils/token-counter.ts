// CJK Unified Ideographs and common CJK ranges
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\uac00-\ud7af]/g;
const CHARS_PER_TOKEN_LATIN = 4;
const CHARS_PER_TOKEN_CJK = 1.5;

/**
 * Estimates token count for a text string.
 * Uses heuristic: ~4 chars per token for latin, ~1.5 chars per token for CJK.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  const cjkChars = (text.match(CJK_REGEX) ?? []).length;
  const nonCjkText = text.replace(CJK_REGEX, '');
  const latinChars = nonCjkText.replace(/\s+/g, ' ').length;

  const cjkTokens = cjkChars / CHARS_PER_TOKEN_CJK;
  const latinTokens = latinChars / CHARS_PER_TOKEN_LATIN;

  return Math.ceil(cjkTokens + latinTokens);
}
