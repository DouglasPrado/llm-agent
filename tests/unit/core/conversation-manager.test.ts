import { describe, it, expect } from 'vitest';
import { ConversationManager } from '../../../src/core/conversation-manager.js';
import type { ChatMessage } from '../../../src/contracts/entities/chat-message.js';

function msg(role: ChatMessage['role'], content: string, pinned = false): ChatMessage {
  return { role, content, pinned, createdAt: Date.now() };
}

describe('ConversationManager', () => {
  it('should append and retrieve messages', () => {
    const cm = new ConversationManager();
    cm.appendMessage(msg('user', 'hello'), 'thread-1');
    cm.appendMessage(msg('assistant', 'hi'), 'thread-1');

    const history = cm.getHistory('thread-1');
    expect(history).toHaveLength(2);
    expect(history[0]!.content).toBe('hello');
  });

  it('should isolate threads', () => {
    const cm = new ConversationManager();
    cm.appendMessage(msg('user', 'a'), 'thread-1');
    cm.appendMessage(msg('user', 'b'), 'thread-2');

    expect(cm.getHistory('thread-1')).toHaveLength(1);
    expect(cm.getHistory('thread-2')).toHaveLength(1);
  });

  it('should clear a thread', () => {
    const cm = new ConversationManager();
    cm.appendMessage(msg('user', 'a'), 'thread-1');
    cm.clearThread('thread-1');
    expect(cm.getHistory('thread-1')).toHaveLength(0);
  });

  it('should get pinned messages', () => {
    const cm = new ConversationManager();
    cm.appendMessage(msg('user', 'important', true), 'thread-1');
    cm.appendMessage(msg('user', 'normal'), 'thread-1');

    const pinned = cm.getPinnedMessages('thread-1');
    expect(pinned).toHaveLength(1);
    expect(pinned[0]!.content).toBe('important');
  });

  it('should serialize concurrent executions on same thread', async () => {
    const cm = new ConversationManager();
    const order: number[] = [];

    const p1 = cm.withThread('t1', async () => {
      await new Promise(r => setTimeout(r, 50));
      order.push(1);
    });

    const p2 = cm.withThread('t1', async () => {
      order.push(2);
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]); // serialized
  });

  it('should allow parallel execution on different threads', async () => {
    const cm = new ConversationManager();
    const order: string[] = [];

    const p1 = cm.withThread('t1', async () => {
      await new Promise(r => setTimeout(r, 50));
      order.push('t1');
    });

    const p2 = cm.withThread('t2', async () => {
      order.push('t2');
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual(['t2', 't1']); // t2 finishes first (parallel)
  });
});
