import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabase } from '../../../src/storage/sqlite-database.js';
import { SQLiteConversationStore } from '../../../src/storage/sqlite-conversation-store.js';
import type { ChatMessage } from '../../../src/contracts/entities/chat-message.js';

function msg(role: ChatMessage['role'], content: string, pinned = false): ChatMessage {
  return { role, content, pinned, createdAt: Date.now() };
}

describe('SQLiteConversationStore', () => {
  let database: SQLiteDatabase;
  let store: SQLiteConversationStore;

  beforeEach(() => {
    database = new SQLiteDatabase(':memory:');
    database.initialize();
    store = new SQLiteConversationStore(database);
  });

  afterEach(() => {
    database.close();
  });

  it('should append and list messages by thread', () => {
    store.appendMessage(msg('user', 'hello'), 'thread-1');
    store.appendMessage(msg('assistant', 'hi there'), 'thread-1');

    const messages = store.listThread('thread-1');
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('user');
    expect(messages[0]!.content).toBe('hello');
    expect(messages[1]!.content).toBe('hi there');
  });

  it('should isolate threads', () => {
    store.appendMessage(msg('user', 'a'), 'thread-1');
    store.appendMessage(msg('user', 'b'), 'thread-2');

    expect(store.listThread('thread-1')).toHaveLength(1);
    expect(store.listThread('thread-2')).toHaveLength(1);
  });

  it('should list only pinned messages', () => {
    store.appendMessage(msg('user', 'important', true), 'thread-1');
    store.appendMessage(msg('user', 'normal', false), 'thread-1');

    const pinned = store.listPinned('thread-1');
    expect(pinned).toHaveLength(1);
    expect(pinned[0]!.content).toBe('important');
  });

  it('should clear a thread', () => {
    store.appendMessage(msg('user', 'a'), 'thread-1');
    store.appendMessage(msg('user', 'b'), 'thread-1');
    store.clearThread('thread-1');

    expect(store.listThread('thread-1')).toHaveLength(0);
  });

  it('should persist tool_calls and tool_call_id', () => {
    const toolMsg: ChatMessage = {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'weather', arguments: '{"city":"NYC"}' } }],
      createdAt: Date.now(),
    };
    store.appendMessage(toolMsg, 'thread-1');

    const toolResult: ChatMessage = {
      role: 'tool',
      content: 'Sunny 25C',
      toolCallId: 'tc1',
      createdAt: Date.now(),
    };
    store.appendMessage(toolResult, 'thread-1');

    const messages = store.listThread('thread-1');
    expect(messages).toHaveLength(2);
    expect(messages[0]!.toolCalls).toHaveLength(1);
    expect(messages[0]!.toolCalls![0]!.function.name).toBe('weather');
    expect(messages[1]!.toolCallId).toBe('tc1');
  });

  it('should return undefined toolCalls for corrupt tool_calls JSON', () => {
    database.db.prepare(`
      INSERT INTO conversations (thread_id, role, content, tool_calls, tool_call_id, pinned, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('t-corrupt', 'assistant', '""', 'NOT_VALID_JSON{{{', null, 0, Date.now());

    const messages = store.listThread('t-corrupt');
    expect(messages).toHaveLength(1);
    expect(messages[0]!.toolCalls).toBeUndefined();
  });

  it('should return empty array for unknown thread', () => {
    expect(store.listThread('nonexistent')).toHaveLength(0);
  });

  it('should throw on invalid role value from database (issue #5)', () => {
    // If the SQLite file is manually edited or corrupted, an invalid role must be
    // caught at the storage boundary — not propagated silently to the LLM layer.
    database.db.prepare(`
      INSERT INTO conversations (thread_id, role, content, tool_calls, tool_call_id, pinned, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('t-badrole', 'INVALID_ROLE', 'hello', null, null, 0, Date.now());

    expect(() => store.listThread('t-badrole')).toThrow(/Invalid message role/);
  });

  it('should order messages by created_at', () => {
    store.appendMessage({ ...msg('user', 'first'), createdAt: 100 }, 'thread-1');
    store.appendMessage({ ...msg('user', 'third'), createdAt: 300 }, 'thread-1');
    store.appendMessage({ ...msg('user', 'second'), createdAt: 200 }, 'thread-1');

    const messages = store.listThread('thread-1');
    expect(messages[0]!.content).toBe('first');
    expect(messages[1]!.content).toBe('second');
    expect(messages[2]!.content).toBe('third');
  });
});
