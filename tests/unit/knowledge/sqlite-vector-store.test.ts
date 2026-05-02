import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SQLiteDatabase } from '../../../src/storage/sqlite-database.js';
import { SQLiteVectorStore } from '../../../src/knowledge/sqlite-vector-store.js';
import type { KnowledgeChunk } from '../../../src/contracts/entities/knowledge.js';

function createChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    id: `chunk-${Math.random().toString(36).slice(2)}`,
    content: 'Some knowledge content',
    embedding: new Float32Array([0.1, 0.2, 0.3, 0.4]),
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('SQLiteVectorStore', () => {
  let database: SQLiteDatabase;
  let store: SQLiteVectorStore;

  beforeEach(() => {
    database = new SQLiteDatabase(':memory:');
    database.initialize();
    store = new SQLiteVectorStore(database);
  });

  afterEach(() => {
    database.close();
  });

  it('should upsert and search by cosine similarity', () => {
    store.upsert(createChunk({ id: 'c1', content: 'TypeScript is great', embedding: new Float32Array([1, 0, 0, 0]) }));
    store.upsert(createChunk({ id: 'c2', content: 'Python is nice', embedding: new Float32Array([0, 1, 0, 0]) }));

    const query = new Float32Array([0.9, 0.1, 0, 0]); // closer to c1
    const results = store.search(query, 2);

    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe('c1');
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it('should respect topK limit', () => {
    for (let i = 0; i < 10; i++) {
      store.upsert(createChunk({ id: `c${i}`, embedding: new Float32Array([Math.random(), Math.random(), 0, 0]) }));
    }

    const results = store.search(new Float32Array([1, 0, 0, 0]), 3);
    expect(results).toHaveLength(3);
  });

  it('should delete chunks', () => {
    store.upsert(createChunk({ id: 'del-1' }));
    store.delete('del-1');

    const results = store.search(new Float32Array([0.1, 0.2, 0.3, 0.4]), 10);
    expect(results.find(r => r.id === 'del-1')).toBeUndefined();
  });

  it('should handle metadata round-trip', () => {
    store.upsert(createChunk({ id: 'meta-1', metadata: { source: 'readme', page: 1 } }));

    const results = store.search(new Float32Array([0.1, 0.2, 0.3, 0.4]), 1);
    expect(results[0]!.metadata).toEqual({ source: 'readme', page: 1 });
  });

  it('should upsert (replace) existing chunk', () => {
    store.upsert(createChunk({ id: 'up-1', content: 'version 1' }));
    store.upsert(createChunk({ id: 'up-1', content: 'version 2' }));

    const results = store.search(new Float32Array([0.1, 0.2, 0.3, 0.4]), 10);
    const found = results.find(r => r.id === 'up-1');
    expect(found!.content).toBe('version 2');
  });

  it('returns score in [0, 1] even for opposite-direction vectors', () => {
    store.upsert(createChunk({ id: 'opp', content: 'opposite', embedding: new Float32Array([1, 0, 0, 0]) }));
    const query = new Float32Array([-1, 0, 0, 0]);
    const results = store.search(query, 1);
    expect(results[0]!.score).toBeGreaterThanOrEqual(0);
    expect(results[0]!.score).toBeLessThanOrEqual(1);
  });

  it('search() uses a LIMIT clause to bound the number of scanned rows (#60)', () => {
    const prepareSpy = vi.spyOn(database.db, 'prepare');
    store.search(new Float32Array([1, 0, 0, 0]), 5);
    const sqlCalls = prepareSpy.mock.calls.map(c => (c[0] as string).toUpperCase());
    const scanSql = sqlCalls.find(sql => sql.includes('FROM VECTORS'));
    expect(scanSql).toBeDefined();
    expect(scanSql).toMatch(/LIMIT/);
    prepareSpy.mockRestore();
  });
});
