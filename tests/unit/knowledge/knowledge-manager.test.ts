import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeManager } from '../../../src/knowledge/knowledge-manager.js';
import type { VectorStore } from '../../../src/contracts/entities/stores.js';
import type { EmbeddingService } from '../../../src/knowledge/embedding-service.js';

function createMockStore(): VectorStore {
  return {
    upsert: vi.fn(),
    search: vi.fn(() => []),
    delete: vi.fn(),
  };
}

function createMockEmbeddingService(): EmbeddingService {
  return {
    embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
    embedSingle: vi.fn(async () => new Float32Array([0.1, 0.2, 0.3])),
  } as unknown as EmbeddingService;
}

describe('KnowledgeManager', () => {
  let store: VectorStore;
  let embeddingService: EmbeddingService;
  let manager: KnowledgeManager;

  beforeEach(() => {
    store = createMockStore();
    embeddingService = createMockEmbeddingService();
    manager = new KnowledgeManager({ store, embeddingService, chunkSize: 50, chunkOverlap: 5 });
  });

  it('should ingest a document and persist chunks', async () => {
    const count = await manager.ingest({ content: 'This is a test document with enough content to be chunked into pieces.' });
    expect(count).toBeGreaterThan(0);
    expect(store.upsert).toHaveBeenCalledTimes(count);
    expect(embeddingService.embed).toHaveBeenCalledOnce();
  });

  it('should return 0 for empty document', async () => {
    const count = await manager.ingest({ content: '' });
    expect(count).toBe(0);
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('should pass metadata to chunks', async () => {
    await manager.ingest({ content: 'Short.', metadata: { source: 'readme' } });
    const chunk = vi.mocked(store.upsert).mock.calls[0]![0]!;
    expect(chunk.metadata).toMatchObject({ source: 'readme', chunkIndex: 0 });
  });

  it('should search and filter by minScore', async () => {
    vi.mocked(store.search).mockReturnValue([
      { id: '1', content: 'good', score: 0.9, metadata: {} },
      { id: '2', content: 'bad', score: 0.1, metadata: {} },
    ]);

    const results = await manager.search('query');
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('1');
  });

  it('should cache search results', async () => {
    vi.mocked(store.search).mockReturnValue([
      { id: '1', content: 'test', score: 0.8 },
    ]);

    await manager.search('query');
    await manager.search('query'); // should hit cache

    expect(embeddingService.embedSingle).toHaveBeenCalledOnce();
  });
});
