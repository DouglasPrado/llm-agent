import { describe, it, expect } from 'vitest';
import { snipCompact } from '../../../src/core/compaction/snip-compact.js';
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

describe('snipCompact', () => {
  it('should not remove messages within tail protection', () => {
    const messages: LLMMessage[] = [
      userMsg('old'),
      assistantMsg('old reply'),
      userMsg('recent'),
      assistantMsg('recent reply'),
    ];

    const result = snipCompact(messages, { tailProtection: 4 });
    expect(result.messages).toEqual(messages);
    expect(result.snippedCount).toBe(0);
  });

  it('should remove orphaned tool results from early messages', () => {
    const messages: LLMMessage[] = [
      userMsg('q1'),
      assistantMsg('a1'),
      toolMsg('old tool result', 'tc-old'),   // orphaned — no reference later
      userMsg('q2'),
      assistantMsg('a2'),
      userMsg('q3'),                           // tail starts here
      assistantMsg('a3'),
    ];

    const result = snipCompact(messages, { tailProtection: 2 });
    // Should remove the orphaned tool result
    expect(result.snippedCount).toBeGreaterThan(0);
    expect(result.messages.some(m => m.role === 'tool' && m.tool_call_id === 'tc-old')).toBe(false);
  });

  it('should preserve system messages', () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are helpful' },
      toolMsg('old result', 'tc-1'),
      userMsg('recent'),
      assistantMsg('reply'),
    ];

    const result = snipCompact(messages, { tailProtection: 2 });
    expect(result.messages.some(m => m.role === 'system')).toBe(true);
  });

  it('should handle empty messages', () => {
    const result = snipCompact([], { tailProtection: 4 });
    expect(result.messages).toEqual([]);
    expect(result.snippedCount).toBe(0);
  });

  it('should preserve pinned messages', () => {
    const pinned = { role: 'user' as const, content: 'summary', _pinned: true } as LLMMessage;
    const messages: LLMMessage[] = [
      pinned,
      toolMsg('old', 'tc-1'),
      userMsg('recent'),
      assistantMsg('reply'),
    ];

    const result = snipCompact(messages, { tailProtection: 2 });
    expect(result.messages.some(m => m.content === 'summary')).toBe(true);
  });

  it('preserves original order (pinned tool result stays after its assistant tool_calls)', () => {
    // Regression: OpenAI API requires a `tool` message to be preceded by an
    // `assistant` message with matching `tool_calls`. Reordering `_pinned` tool
    // results to before the assistant message broke that invariant.
    const assistantWithToolCalls: LLMMessage = {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'skill-1', type: 'function', function: { name: 'Skill', arguments: '{}' } }],
    };
    const pinnedToolResult = {
      role: 'tool' as const,
      content: 'skill instructions',
      tool_call_id: 'skill-1',
      _pinned: true,
    } as LLMMessage;

    const messages: LLMMessage[] = [
      { role: 'system', content: 'sys' },
      userMsg('/testarapi'),
      assistantWithToolCalls,
      pinnedToolResult,
    ];

    const result = snipCompact(messages, { tailProtection: 10 });
    expect(result.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    // pinned tool result comes right after its assistant tool_calls
    const assistantIdx = result.messages.findIndex(m => m.role === 'assistant' && !!m.tool_calls);
    const toolIdx = result.messages.findIndex(m => m.role === 'tool');
    expect(toolIdx).toBe(assistantIdx + 1);
  });

  it('preserves order across system + pinned + regular mix', () => {
    const pinned = { role: 'user' as const, content: 'pinned-user', _pinned: true } as LLMMessage;
    const messages: LLMMessage[] = [
      { role: 'system', content: 'sys' },
      userMsg('u1'),
      pinned,
      assistantMsg('a1'),
    ];
    const result = snipCompact(messages, { tailProtection: 10 });
    expect(result.messages.map(m => m.content)).toEqual(['sys', 'u1', 'pinned-user', 'a1']);
  });
});
