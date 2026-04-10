import { describe, it, expect, vi } from 'vitest';
import { microcompact } from '../../../src/core/compaction/microcompact.js';
import { autocompact } from '../../../src/core/compaction/autocompact.js';
import type { LLMMessage } from '../../../src/llm/message-types.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';

describe('microcompact', () => {
  it('should truncate tool results exceeding maxChars', () => {
    const longContent = 'x'.repeat(15_000);
    const messages: LLMMessage[] = [
      { role: 'user', content: 'search files' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' } }] },
      { role: 'tool', content: longContent, tool_call_id: 'c1' },
      { role: 'assistant', content: 'Found results' },
    ];

    const result = microcompact(messages, { maxToolResultChars: 10_000 });

    expect(result.messages).toHaveLength(4);
    const toolMsg = result.messages[2]!;
    expect(typeof toolMsg.content === 'string' ? toolMsg.content.length : 0).toBeLessThan(longContent.length);
    expect(typeof toolMsg.content === 'string' ? toolMsg.content : '').toContain('[truncated');
    expect(result.truncatedCount).toBe(1);
  });

  it('should not modify messages under the limit', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ];

    const result = microcompact(messages, { maxToolResultChars: 10_000 });

    expect(result.messages).toEqual(messages);
    expect(result.truncatedCount).toBe(0);
  });

  it('should preserve head and tail of truncated content', () => {
    const content = 'HEAD_CONTENT' + 'x'.repeat(15_000) + 'TAIL_CONTENT';
    const messages: LLMMessage[] = [
      { role: 'tool', content, tool_call_id: 'c1' },
    ];

    const result = microcompact(messages, { maxToolResultChars: 1_000 });

    const truncated = result.messages[0]!.content as string;
    expect(truncated).toContain('HEAD_CONTENT');
    expect(truncated).toContain('TAIL_CONTENT');
  });

  it('should handle multiple large tool results', () => {
    const messages: LLMMessage[] = [
      { role: 'tool', content: 'a'.repeat(20_000), tool_call_id: 'c1' },
      { role: 'tool', content: 'b'.repeat(20_000), tool_call_id: 'c2' },
      { role: 'tool', content: 'small', tool_call_id: 'c3' },
    ];

    const result = microcompact(messages, { maxToolResultChars: 10_000 });

    expect(result.truncatedCount).toBe(2);
    expect(result.messages[2]!.content).toBe('small');
  });
});

describe('autocompact', () => {
  function createMockClient(summaryResponse: string): LLMClient {
    return {
      chat: vi.fn().mockResolvedValue({
        content: summaryResponse,
        finishReason: 'stop',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }),
    } as unknown as LLMClient;
  }

  it('should summarize messages when threshold exceeded', async () => {
    const client = createMockClient('Summary of the conversation so far.');

    // Create enough messages to exceed threshold
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer with lots of detail '.repeat(100) },
      { role: 'user', content: 'Second question' },
      { role: 'assistant', content: 'Second answer with lots of detail '.repeat(100) },
      { role: 'user', content: 'Third question' },
      { role: 'assistant', content: 'Third answer' },
    ];

    const result = await autocompact(messages, client, {
      maxContextTokens: 500, // Low threshold to trigger
      compactionThreshold: 0.5, // 50%
      tailProtection: 2, // Keep last 2 messages
    });

    expect(result).not.toBeNull();
    if (result) {
      // Should have: system + summary + last 2 messages (tail protection)
      expect(result.messages.length).toBeLessThan(messages.length);
      // Summary should be present
      const summaryMsg = result.messages.find(m =>
        typeof m.content === 'string' && m.content.includes('Summary of the conversation'),
      );
      expect(summaryMsg).toBeDefined();
      // Tail messages preserved
      expect(result.messages[result.messages.length - 1]!.content).toBe('Third answer');
    }
  });

  it('should return null when under threshold', async () => {
    const client = createMockClient('Summary');
    const messages: LLMMessage[] = [
      { role: 'user', content: 'short' },
      { role: 'assistant', content: 'reply' },
    ];

    const result = await autocompact(messages, client, {
      maxContextTokens: 128_000,
      compactionThreshold: 0.8,
      tailProtection: 2,
    });

    expect(result).toBeNull();
    expect(client.chat).not.toHaveBeenCalled();
  });

  it('should always preserve system messages', async () => {
    const client = createMockClient('Summary.');
    const messages: LLMMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'question '.repeat(500) },
      { role: 'assistant', content: 'answer '.repeat(500) },
      { role: 'user', content: 'recent' },
    ];

    const result = await autocompact(messages, client, {
      maxContextTokens: 200,
      compactionThreshold: 0.5,
      tailProtection: 1,
    });

    expect(result).not.toBeNull();
    if (result) {
      expect(result.messages[0]!.role).toBe('system');
      expect(result.messages[0]!.content).toBe('System prompt');
    }
  });

  it('should return null on LLM error', async () => {
    const client = {
      chat: vi.fn().mockRejectedValue(new Error('API error')),
    } as unknown as LLMClient;

    const messages: LLMMessage[] = [
      { role: 'user', content: 'question '.repeat(500) },
      { role: 'assistant', content: 'answer '.repeat(500) },
    ];

    const result = await autocompact(messages, client, {
      maxContextTokens: 200,
      compactionThreshold: 0.5,
      tailProtection: 1,
    });

    expect(result).toBeNull();
  });
});
