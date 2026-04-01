import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../../src/agent.js';
import type { MemoryStore, VectorStore, ConversationStore } from '../../../src/contracts/entities/stores.js';
import type { Memory } from '../../../src/contracts/entities/memory.js';
import type { ChatMessage } from '../../../src/contracts/entities/chat-message.js';

function createCustomMemoryStore(): MemoryStore {
  const memories = new Map<string, Memory>();
  return {
    save: vi.fn((m: Memory) => { memories.set(m.id, m); return m; }),
    search: vi.fn(() => []),
    findById: vi.fn((id: string) => memories.get(id) ?? null),
    incrementAccess: vi.fn(),
    deleteLowConfidence: vi.fn(() => 0),
    listByScope: vi.fn(() => []),
  };
}

function createCustomVectorStore(): VectorStore {
  return {
    upsert: vi.fn(),
    search: vi.fn(() => []),
    delete: vi.fn(),
  };
}

function createCustomConversationStore(): ConversationStore {
  const threads = new Map<string, ChatMessage[]>();
  return {
    appendMessage: vi.fn((msg: ChatMessage, threadId: string) => {
      if (!threads.has(threadId)) threads.set(threadId, []);
      threads.get(threadId)!.push(msg);
    }),
    listThread: vi.fn((threadId: string) => threads.get(threadId) ?? []),
    listPinned: vi.fn((threadId: string) => (threads.get(threadId) ?? []).filter(m => m.pinned)),
    clearThread: vi.fn((threadId: string) => threads.delete(threadId)),
  };
}

describe('Pluggable Stores (ENT-011)', () => {
  it('should accept a custom MemoryStore', async () => {
    const store = createCustomMemoryStore();
    const agent = Agent.create({
      apiKey: 'test-key',
      memory: { enabled: true, store },
      knowledge: { enabled: false },
    });

    const mem = await agent.remember('Custom store works');
    expect(store.save).toHaveBeenCalledOnce();
    expect(mem.content).toBe('Custom store works');
  });

  it('should accept a custom VectorStore', () => {
    const store = createCustomVectorStore();
    const agent = Agent.create({
      apiKey: 'test-key',
      memory: { enabled: false },
      knowledge: { enabled: true, store },
    });

    // Agent should be created without error
    expect(agent).toBeDefined();
  });

  it('should accept a custom ConversationStore', () => {
    const store = createCustomConversationStore();
    const agent = Agent.create({
      apiKey: 'test-key',
      memory: { enabled: false },
      knowledge: { enabled: false },
      conversation: { store },
    });

    expect(agent).toBeDefined();
  });

  it('should use custom MemoryStore for recall', async () => {
    const store = createCustomMemoryStore();
    const mem: Memory = {
      id: 'custom-1', content: 'remembers this', scope: 'persistent', category: 'fact',
      confidence: 0.9, accessCount: 0, source: 'explicit', createdAt: Date.now(),
      lastAccessedAt: Date.now(), state: 'active',
    };
    vi.mocked(store.search).mockReturnValue([mem]);

    const agent = Agent.create({
      apiKey: 'test-key',
      memory: { enabled: true, store },
      knowledge: { enabled: false },
    });

    const results = await agent.recall('test');
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe('remembers this');
    expect(store.search).toHaveBeenCalledOnce();
    expect(store.incrementAccess).toHaveBeenCalledWith('custom-1');
  });

  it('should export store interfaces from index.ts', async () => {
    const { SQLiteMemoryStore, SQLiteVectorStore, SQLiteDatabase } = await import('../../../src/index.js');
    expect(SQLiteMemoryStore).toBeDefined();
    expect(SQLiteVectorStore).toBeDefined();
    expect(SQLiteDatabase).toBeDefined();
  });
});
