import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabase } from '../../../src/storage/sqlite-database.js';
import { SQLiteMemoryStore } from '../../../src/memory/sqlite-memory-store.js';
import type { Memory } from '../../../src/contracts/entities/memory.js';

function createMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: `mem-${Math.random().toString(36).slice(2)}`,
    content: 'The user prefers dark mode',
    scope: 'persistent',
    category: 'preference',
    confidence: 0.8,
    accessCount: 0,
    source: 'extracted',
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
    state: 'active',
    ...overrides,
  };
}

describe('SQLiteMemoryStore', () => {
  let database: SQLiteDatabase;
  let store: SQLiteMemoryStore;

  beforeEach(() => {
    database = new SQLiteDatabase(':memory:');
    database.initialize();
    store = new SQLiteMemoryStore(database);
  });

  afterEach(() => {
    database.close();
  });

  it('should save and retrieve a memory by id', () => {
    const memory = createMemory({ id: 'test-1' });
    store.save(memory);

    const found = store.findById('test-1');
    expect(found).not.toBeNull();
    expect(found!.content).toBe('The user prefers dark mode');
    expect(found!.scope).toBe('persistent');
  });

  it('should return null for missing id', () => {
    expect(store.findById('nonexistent')).toBeNull();
  });

  it('should search via FTS5', () => {
    store.save(createMemory({ content: 'The user likes TypeScript' }));
    store.save(createMemory({ content: 'The weather is sunny today' }));

    const results = store.search('TypeScript');
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toContain('TypeScript');
  });

  it('should filter by minimum confidence', () => {
    store.save(createMemory({ content: 'low conf', confidence: 0.05 }));
    store.save(createMemory({ content: 'high conf', confidence: 0.9 }));

    const results = store.search('conf', { minConfidence: 0.5 });
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe('high conf');
  });

  it('should increment access count and confidence', () => {
    const mem = createMemory({ id: 'inc-1', confidence: 0.5 });
    store.save(mem);

    store.incrementAccess('inc-1');
    const updated = store.findById('inc-1')!;
    expect(updated.accessCount).toBe(1);
    expect(updated.confidence).toBeCloseTo(0.55);
  });

  it('should cap confidence at 1.0 on increment', () => {
    const mem = createMemory({ id: 'cap-1', confidence: 0.98 });
    store.save(mem);

    store.incrementAccess('cap-1');
    const updated = store.findById('cap-1')!;
    expect(updated.confidence).toBeLessThanOrEqual(1.0);
  });

  it('should delete low confidence memories', () => {
    store.save(createMemory({ id: 'low', confidence: 0.05 }));
    store.save(createMemory({ id: 'high', confidence: 0.9 }));

    const deleted = store.deleteLowConfidence(0.1);
    expect(deleted).toBe(1);
    expect(store.findById('low')).toBeNull();
    expect(store.findById('high')).not.toBeNull();
  });

  it('should list by scope', () => {
    store.save(createMemory({ scope: 'persistent' }));
    store.save(createMemory({ scope: 'thread', threadId: 'thread-1' }));
    store.save(createMemory({ scope: 'thread', threadId: 'thread-2' }));

    const persistent = store.listByScope('persistent');
    expect(persistent).toHaveLength(1);

    const thread1 = store.listByScope('thread', 'thread-1');
    expect(thread1).toHaveLength(1);
  });

  it('should handle embeddings round-trip', () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const mem = createMemory({ id: 'emb-1', embedding });
    store.save(mem);

    const found = store.findById('emb-1')!;
    expect(found.embedding).toBeInstanceOf(Float32Array);
    expect(found.embedding!.length).toBe(4);
    expect(found.embedding![0]).toBeCloseTo(0.1);
  });
});
