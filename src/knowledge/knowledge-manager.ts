import { randomUUID } from 'node:crypto';
import type { VectorStore } from '../contracts/entities/stores.js';
import type { KnowledgeDocument, KnowledgeChunk, RetrievedKnowledge } from '../contracts/entities/knowledge.js';
import type { EmbeddingService } from './embedding-service.js';
import { chunkText } from './chunking.js';
import { LRUCache } from '../utils/cache.js';

export interface KnowledgeManagerConfig {
  store: VectorStore;
  embeddingService: EmbeddingService;
  chunkSize?: number;
  chunkOverlap?: number;
  topK?: number;
  minScore?: number;
}

/**
 * Manages knowledge ingestion (chunking + embedding) and RAG search.
 */
export class KnowledgeManager {
  private readonly store: VectorStore;
  private readonly embeddingService: EmbeddingService;
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly topK: number;
  private readonly minScore: number;
  private readonly searchCache: LRUCache<string, RetrievedKnowledge[]>;

  constructor(config: KnowledgeManagerConfig) {
    this.store = config.store;
    this.embeddingService = config.embeddingService;
    this.chunkSize = config.chunkSize ?? 512;
    this.chunkOverlap = config.chunkOverlap ?? 64;
    this.topK = config.topK ?? 5;
    this.minScore = config.minScore ?? 0.3;
    this.searchCache = new LRUCache<string, RetrievedKnowledge[]>({ maxSize: 100, ttl: 300_000 });
  }

  /**
   * Ingests a document: chunks it, generates embeddings, and persists.
   */
  async ingest(document: KnowledgeDocument): Promise<number> {
    const chunks = chunkText(document.content, {
      chunkSize: this.chunkSize,
      chunkOverlap: this.chunkOverlap,
    });

    if (chunks.length === 0) return 0;

    const embeddings = await this.embeddingService.embed(chunks);

    for (let i = 0; i < chunks.length; i++) {
      const chunk: KnowledgeChunk = {
        id: randomUUID(),
        content: chunks[i]!,
        embedding: new Float32Array(embeddings[i]!),
        metadata: { ...document.metadata, chunkIndex: i, totalChunks: chunks.length },
        createdAt: Date.now(),
      };
      this.store.upsert(chunk);
    }

    return chunks.length;
  }

  /**
   * Searches knowledge by semantic similarity.
   */
  async search(query: string): Promise<RetrievedKnowledge[]> {
    // Check cache
    const cached = this.searchCache.get(query);
    if (cached) return cached;

    const queryEmbedding = await this.embeddingService.embedSingle(query);
    const results = this.store.search(queryEmbedding, this.topK)
      .filter(r => r.score >= this.minScore);

    this.searchCache.set(query, results);
    return results;
  }
}
