import { describe, it, expect } from 'vitest';
import { applyToolResultBudget } from '../../../src/core/compaction/tool-result-budget.js';
import type { LLMMessage } from '../../../src/llm/message-types.js';

function toolMsg(content: string, id = 'tc-1'): LLMMessage {
  return { role: 'tool', content, tool_call_id: id };
}

function userMsg(content: string): LLMMessage {
  return { role: 'user', content };
}

function assistantMsg(content: string): LLMMessage {
  return { role: 'assistant', content };
}

describe('applyToolResultBudget', () => {
  it('should not modify messages within budget', () => {
    const messages: LLMMessage[] = [
      userMsg('hi'),
      assistantMsg('hello'),
      toolMsg('short result', 'tc-1'),
    ];

    const result = applyToolResultBudget(messages, { maxTotalToolResultChars: 10_000 });
    expect(result.messages).toEqual(messages);
    expect(result.truncatedCount).toBe(0);
  });

  it('should truncate largest tool results first when over budget', () => {
    const messages: LLMMessage[] = [
      toolMsg('x'.repeat(5000), 'tc-1'),  // 5000 chars
      toolMsg('y'.repeat(3000), 'tc-2'),  // 3000 chars
      toolMsg('z'.repeat(1000), 'tc-3'),  // 1000 chars — smallest, should survive
    ];

    // Budget of 5000 — total is 9000, need to cut ~4000
    const result = applyToolResultBudget(messages, { maxTotalToolResultChars: 5000 });

    // Largest (5000) should be truncated
    expect(result.truncatedCount).toBeGreaterThan(0);

    // Total chars should be roughly within budget
    const totalChars = result.messages
      .filter(m => m.role === 'tool')
      .reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
    expect(totalChars).toBeLessThanOrEqual(6000); // some overhead from truncation markers
  });

  it('should preserve non-tool messages', () => {
    const messages: LLMMessage[] = [
      userMsg('question'),
      assistantMsg('answer'),
      toolMsg('x'.repeat(20000), 'tc-1'),
    ];

    const result = applyToolResultBudget(messages, { maxTotalToolResultChars: 1000 });

    expect(result.messages[0]).toEqual(userMsg('question'));
    expect(result.messages[1]).toEqual(assistantMsg('answer'));
  });

  it('should handle empty messages', () => {
    const result = applyToolResultBudget([], { maxTotalToolResultChars: 1000 });
    expect(result.messages).toEqual([]);
    expect(result.truncatedCount).toBe(0);
  });

  it('should handle no tool messages', () => {
    const messages: LLMMessage[] = [
      userMsg('hi'),
      assistantMsg('hello'),
    ];

    const result = applyToolResultBudget(messages, { maxTotalToolResultChars: 1000 });
    expect(result.messages).toEqual(messages);
    expect(result.truncatedCount).toBe(0);
  });

  it('should add truncation marker with original length', () => {
    const messages: LLMMessage[] = [
      toolMsg('x'.repeat(10000), 'tc-1'),
    ];

    const result = applyToolResultBudget(messages, { maxTotalToolResultChars: 500 });
    const content = result.messages[0]!.content as string;

    expect(content).toContain('[truncated');
    expect(content.length).toBeLessThan(10000);
  });
});
