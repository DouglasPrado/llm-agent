import { describe, it, expect } from 'vitest';
import { buildContext, type ContextInjection } from '../../../src/core/context-builder.js';
import type { ChatMessage } from '../../../src/contracts/entities/chat-message.js';

function msg(role: ChatMessage['role'], content: string, pinned = false): ChatMessage {
  return { role, content, pinned, createdAt: Date.now() };
}

describe('buildContext', () => {
  it('should include system prompt', () => {
    const result = buildContext({
      systemPrompt: 'You are helpful',
      injections: [],
      history: [],
      maxTokens: 10000,
      reserveTokens: 100,
      maxPinnedMessages: 20,
    });

    expect(result.messages[0]!.role).toBe('system');
    expect(result.messages[0]!.content).toContain('You are helpful');
  });

  it('should inject content by priority', () => {
    const injections: ContextInjection[] = [
      { source: 'memory', priority: 5, content: 'Memory: user likes TS', tokens: 10 },
      { source: 'knowledge', priority: 10, content: 'Knowledge: TS is typed JS', tokens: 10 },
    ];

    const result = buildContext({
      systemPrompt: 'Base',
      injections,
      history: [],
      maxTokens: 10000,
      reserveTokens: 100,
      maxPinnedMessages: 20,
    });

    const content = result.messages[0]!.content as string;
    // Higher priority should appear first
    expect(content.indexOf('Knowledge')).toBeLessThan(content.indexOf('Memory'));
  });

  it('should skip injections that exceed budget', () => {
    const injections: ContextInjection[] = [
      { source: 'big', priority: 10, content: 'x'.repeat(1000), tokens: 9999 },
    ];

    const result = buildContext({
      systemPrompt: 'Base',
      injections,
      history: [],
      maxTokens: 100,
      reserveTokens: 10,
      maxPinnedMessages: 20,
    });

    expect(result.injections).toHaveLength(0);
  });

  it('should always include pinned messages', () => {
    const history = [
      msg('user', 'pinned message', true),
      msg('assistant', 'reply'),
      msg('user', 'normal 1'),
    ];

    const result = buildContext({
      injections: [],
      history,
      maxTokens: 10000,
      reserveTokens: 100,
      maxPinnedMessages: 20,
    });

    const allContent = result.messages.map(m => m.content).join(' ');
    expect(allContent).toContain('pinned message');
  });

  it('should include recent messages when budget allows', () => {
    // Alternate roles to avoid merge
    const history = Array.from({ length: 5 }, (_, i) =>
      msg(i % 2 === 0 ? 'user' : 'assistant', `msg ${i}`),
    );

    const result = buildContext({
      injections: [],
      history,
      maxTokens: 10000,
      reserveTokens: 100,
      maxPinnedMessages: 20,
    });

    expect(result.messages.length).toBe(5);
  });

  it('should trim oldest unpinned messages when budget is tight', () => {
    const history = Array.from({ length: 50 }, (_, i) => msg('user', `message number ${i} with some content`));

    const result = buildContext({
      injections: [],
      history,
      maxTokens: 200,
      reserveTokens: 50,
      maxPinnedMessages: 20,
    });

    // Should include fewer messages than the full 50
    expect(result.messages.length).toBeLessThan(50);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  // --- System Reminder Wrapping ---

  it('should wrap injections in <system-reminder> tags', () => {
    const injections: ContextInjection[] = [
      { source: 'tools', priority: 10, content: 'Tool list here', tokens: 5 },
    ];

    const result = buildContext({
      systemPrompt: 'Base prompt',
      injections,
      history: [],
      maxTokens: 10000,
      reserveTokens: 100,
      maxPinnedMessages: 20,
    });

    const content = result.messages[0]!.content as string;
    expect(content).toContain('<system-reminder>');
    expect(content).toContain('Tool list here');
    expect(content).toContain('</system-reminder>');
  });

  it('should NOT wrap the base system prompt in system-reminder', () => {
    const result = buildContext({
      systemPrompt: 'You are a helpful assistant',
      injections: [{ source: 'env', priority: 1, content: 'Date: today', tokens: 3 }],
      history: [],
      maxTokens: 10000,
      reserveTokens: 100,
      maxPinnedMessages: 20,
    });

    const content = result.messages[0]!.content as string;
    // Base prompt should NOT be wrapped
    expect(content.startsWith('<system-reminder>')).toBe(false);
    expect(content).toContain('You are a helpful assistant');
    // Injection SHOULD be wrapped
    expect(content).toContain('<system-reminder>\nDate: today\n</system-reminder>');
  });

  it('should wrap each injection separately', () => {
    const injections: ContextInjection[] = [
      { source: 'tools', priority: 10, content: 'Tools section', tokens: 5 },
      { source: 'memory', priority: 5, content: 'Memory section', tokens: 5 },
    ];

    const result = buildContext({
      injections,
      history: [],
      maxTokens: 10000,
      reserveTokens: 100,
      maxPinnedMessages: 20,
    });

    const content = result.messages[0]!.content as string;
    const reminderCount = (content.match(/<system-reminder>/g) || []).length;
    expect(reminderCount).toBe(2);
  });

  // --- Message Merge ---

  it('should merge consecutive user messages', () => {
    const history = [
      msg('user', 'first'),
      msg('user', 'second'),
      msg('assistant', 'reply'),
      msg('user', 'third'),
    ];

    const result = buildContext({
      injections: [],
      history,
      maxTokens: 10000,
      reserveTokens: 100,
      maxPinnedMessages: 20,
    });

    // Two consecutive user messages should be merged into one
    const userMessages = result.messages.filter(m => m.role === 'user');
    const firstUser = userMessages[0]!.content as string;
    expect(firstUser).toContain('first');
    expect(firstUser).toContain('second');
    // Total should be 3 (merged user + assistant + user), not 4
    expect(result.messages.length).toBe(3);
  });

  it('should propagate _pinned flag from pinned ChatMessage to LLMMessage (issue #1)', () => {
    // A skill tool result is stored in SQLite with pinned=true.
    // When loaded back and converted to LLMMessage, _pinned must be set so that
    // autocompact / snipCompact honour it in resumed sessions.
    const pinnedTool: ChatMessage = { role: 'tool', content: 'skill output', pinned: true, toolCallId: 'tc1', createdAt: 1 };
    const unpinnedTool: ChatMessage = { role: 'tool', content: 'regular output', pinned: false, toolCallId: 'tc2', createdAt: 2 };

    const result = buildContext({
      systemPrompt: '',
      injections: [],
      history: [pinnedTool, unpinnedTool],
      maxTokens: 10000,
      reserveTokens: 0,
      maxPinnedMessages: 20,
    });

    const llmPinned = result.messages.find(m => m.tool_call_id === 'tc1');
    const llmUnpinned = result.messages.find(m => m.tool_call_id === 'tc2');

    expect(llmPinned).toBeDefined();
    expect((llmPinned as unknown as Record<string, unknown>)._pinned).toBe(true);
    expect((llmUnpinned as unknown as Record<string, unknown>)._pinned).toBeUndefined();
  });
});
