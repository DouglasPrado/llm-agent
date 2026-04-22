import { describe, it, expect } from 'vitest';
import { normalizeMessagesForAPI } from '../../../src/core/message-normalize.js';
import type { LLMMessage } from '../../../src/llm/message-types.js';

function system(content: string): LLMMessage {
  return { role: 'system', content };
}
function user(content: string): LLMMessage {
  return { role: 'user', content };
}
function assistant(content: string, opts?: { tool_calls?: LLMMessage['tool_calls'] }): LLMMessage {
  return { role: 'assistant', content, ...(opts?.tool_calls ? { tool_calls: opts.tool_calls } : {}) };
}
function tool(content: string, id: string): LLMMessage {
  return { role: 'tool', content, tool_call_id: id };
}

describe('normalizeMessagesForAPI', () => {
  it('should pass through valid message sequence', () => {
    const messages: LLMMessage[] = [
      system('You are helpful'),
      user('Hello'),
      assistant('Hi!'),
    ];

    const result = normalizeMessagesForAPI(messages);
    expect(result).toEqual(messages);
  });

  it('should ensure tool_result follows tool_use', () => {
    // Valid: assistant with tool_calls → tool result
    const messages: LLMMessage[] = [
      user('search for cats'),
      assistant('', {
        tool_calls: [{ id: 'tc-1', type: 'function', function: { name: 'search', arguments: '{}' } }],
      }),
      tool('cats found', 'tc-1'),
    ];

    const result = normalizeMessagesForAPI(messages);
    expect(result).toHaveLength(3);
    // tool result should follow assistant with tool_calls
    expect(result[1]!.tool_calls).toBeDefined();
    expect(result[2]!.role).toBe('tool');
  });

  it('should remove orphaned tool results (no matching tool_call)', () => {
    const messages: LLMMessage[] = [
      user('hello'),
      assistant('hi'),
      tool('orphaned result', 'tc-nonexistent'),  // no assistant with this tool_call_id
      user('next question'),
    ];

    const result = normalizeMessagesForAPI(messages);
    // Orphaned tool result should be removed
    const toolMessages = result.filter(m => m.role === 'tool');
    expect(toolMessages).toHaveLength(0);
    // Other messages preserved
    expect(result.some(m => m.content === 'hello')).toBe(true);
    expect(result.some(m => m.content === 'next question')).toBe(true);
  });

  it('should remove assistant tool_calls with no matching tool results', () => {
    const messages: LLMMessage[] = [
      user('do something'),
      assistant('', {
        tool_calls: [{ id: 'tc-1', type: 'function', function: { name: 'search', arguments: '{}' } }],
      }),
      // Missing tool result for tc-1
      user('next question'),
    ];

    const result = normalizeMessagesForAPI(messages);
    // The assistant with orphaned tool_calls should have tool_calls stripped
    const assistantWithCalls = result.find(m => m.role === 'assistant' && m.tool_calls);
    expect(assistantWithCalls).toBeUndefined();
  });

  it('should keep system message at the start', () => {
    const messages: LLMMessage[] = [
      system('instructions'),
      user('hi'),
      assistant('hello'),
    ];

    const result = normalizeMessagesForAPI(messages);
    expect(result[0]!.role).toBe('system');
  });

  it('should handle empty messages', () => {
    expect(normalizeMessagesForAPI([])).toEqual([]);
  });

  it('should handle multiple tool calls and results', () => {
    const messages: LLMMessage[] = [
      user('search and read'),
      assistant('', {
        tool_calls: [
          { id: 'tc-1', type: 'function', function: { name: 'search', arguments: '{}' } },
          { id: 'tc-2', type: 'function', function: { name: 'read', arguments: '{}' } },
        ],
      }),
      tool('search result', 'tc-1'),
      tool('read result', 'tc-2'),
      assistant('Here are the results'),
    ];

    const result = normalizeMessagesForAPI(messages);
    expect(result).toHaveLength(5);
    // Both tool results should be present
    expect(result.filter(m => m.role === 'tool')).toHaveLength(2);
  });

  it('should strip empty content assistant messages without tool_calls', () => {
    const messages: LLMMessage[] = [
      user('hi'),
      assistant(''),  // empty, no tool_calls — useless
      user('hello again'),
    ];

    const result = normalizeMessagesForAPI(messages);
    const emptyAssistant = result.filter(m => m.role === 'assistant' && m.content === '');
    expect(emptyAssistant).toHaveLength(0);
  });

  it('strips a tool message that comes before its assistant tool_calls (positional orphan)', () => {
    // Regression: upstream code (snipCompact / autocompact) can move a _pinned
    // tool result to before its assistant, violating OpenAI's invariant that
    // a `tool` message must be preceded by an `assistant` with matching
    // `tool_calls`. The normalizer catches this as a safety net.
    const messages: LLMMessage[] = [
      system('sys'),
      tool('stale skill result', 'skill-1'),   // orphan in position
      user('/testarapi'),
      assistant('', {
        tool_calls: [{ id: 'skill-1', type: 'function', function: { name: 'Skill', arguments: '{}' } }],
      }),
      tool('fresh skill result', 'skill-1'),
    ];

    const result = normalizeMessagesForAPI(messages);
    expect(result.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    const tools = result.filter(m => m.role === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0]!.content).toBe('fresh skill result');
  });

  it('drops a positionally-orphaned tool even when its assistant has no valid result afterwards', () => {
    const messages: LLMMessage[] = [
      system('sys'),
      tool('orphan', 'skill-1'),
      user('hi'),
      assistant('', {
        tool_calls: [{ id: 'skill-1', type: 'function', function: { name: 'Skill', arguments: '{}' } }],
      }),
    ];

    const result = normalizeMessagesForAPI(messages);
    expect(result.some(m => m.role === 'tool')).toBe(false);
    // Assistant with empty content and orphan tool_calls gets dropped.
    expect(result.some(m => m.role === 'assistant')).toBe(false);
  });
});
