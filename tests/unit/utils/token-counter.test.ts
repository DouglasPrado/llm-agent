import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../../../src/utils/token-counter.js';

describe('TokenCounter', () => {
  it('should estimate tokens for latin text (~4 chars per token)', () => {
    const text = 'Hello, this is a test message for token counting.';
    const tokens = estimateTokens(text);
    // ~50 chars / 4 = ~12 tokens
    expect(tokens).toBeGreaterThan(8);
    expect(tokens).toBeLessThan(20);
  });

  it('should estimate tokens for CJK text (~1.5 chars per token)', () => {
    const text = '这是一个测试消息用于令牌计数';
    const tokens = estimateTokens(text);
    // 14 CJK chars / 1.5 = ~9 tokens
    expect(tokens).toBeGreaterThan(5);
    expect(tokens).toBeLessThan(15);
  });

  it('should handle mixed latin and CJK text', () => {
    const text = 'Hello 你好 World 世界';
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(3);
    expect(tokens).toBeLessThan(15);
  });

  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should handle whitespace-only strings', () => {
    expect(estimateTokens('   ')).toBeGreaterThanOrEqual(0);
  });

  it('should estimate tokens for an array of messages', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi there!' },
    ];
    const tokens = estimateTokens(messages.map(m => m.content).join('\n'));
    expect(tokens).toBeGreaterThan(2);
  });
});
