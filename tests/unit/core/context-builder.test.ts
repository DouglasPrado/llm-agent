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
      msg('user', 'normal 1'),
      msg('user', 'normal 2'),
    ];

    const result = buildContext({
      injections: [],
      history,
      maxTokens: 10000,
      reserveTokens: 100,
      maxPinnedMessages: 20,
    });

    const contents = result.messages.map(m => m.content);
    expect(contents).toContain('pinned message');
  });

  it('should include recent messages when budget allows', () => {
    const history = Array.from({ length: 5 }, (_, i) => msg('user', `msg ${i}`));

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
});
