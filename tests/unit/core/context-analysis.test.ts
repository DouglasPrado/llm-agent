import { describe, it, expect } from 'vitest';
import { analyzeContext } from '../../../src/core/context-analysis.js';
import type { LLMMessage } from '../../../src/llm/message-types.js';

describe('analyzeContext', () => {
  it('should count tokens by role', () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello there' },
      { role: 'assistant', content: 'Hi!' },
    ];

    const analysis = analyzeContext(messages);
    expect(analysis.totalTokens).toBeGreaterThan(0);
    expect(analysis.byRole.system).toBeGreaterThan(0);
    expect(analysis.byRole.user).toBeGreaterThan(0);
    expect(analysis.byRole.assistant).toBeGreaterThan(0);
  });

  it('should count tool result tokens', () => {
    const messages: LLMMessage[] = [
      { role: 'tool', content: 'result data', tool_call_id: 'tc-1' },
      { role: 'tool', content: 'more data', tool_call_id: 'tc-2' },
    ];

    const analysis = analyzeContext(messages);
    expect(analysis.byRole.tool).toBeGreaterThan(0);
    expect(analysis.toolResultCount).toBe(2);
    expect(analysis.toolResultChars).toBeGreaterThan(0);
  });

  it('should return message count', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ];

    const analysis = analyzeContext(messages);
    expect(analysis.messageCount).toBe(3);
  });

  it('should handle empty messages', () => {
    const analysis = analyzeContext([]);
    expect(analysis.totalTokens).toBe(0);
    expect(analysis.messageCount).toBe(0);
  });
});
