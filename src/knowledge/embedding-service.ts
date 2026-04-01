import type { OpenRouterClient } from '../llm/openrouter-client.js';
import { LRUCache } from '../utils/cache.js';

/**
 * Generates embeddings via OpenRouter with LRU caching.
 */
export class EmbeddingService {
  private readonly client: OpenRouterClient;
  private readonly cache: LRUCache<string, number[]>;
  private readonly model?: string;

  constructor(client: OpenRouterClient, options?: { model?: string; cacheSize?: number }) {
    this.client = client;
    this.model = options?.model;
    this.cache = new LRUCache<string, number[]>({ maxSize: options?.cacheSize ?? 10_000, ttl: 3_600_000 });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = new Array(texts.length);
    const uncached: Array<{ index: number; text: string }> = [];

    // Check cache
    for (let i = 0; i < texts.length; i++) {
      const cached = this.cache.get(texts[i]!);
      if (cached) {
        results[i] = cached;
      } else {
        uncached.push({ index: i, text: texts[i]! });
      }
    }

    // Fetch uncached
    if (uncached.length > 0) {
      const embeddings = await this.client.embed(uncached.map(u => u.text), this.model);
      for (let i = 0; i < uncached.length; i++) {
        const entry = uncached[i]!;
        results[entry.index] = embeddings[i]!;
        this.cache.set(entry.text, embeddings[i]!);
      }
    }

    return results;
  }

  async embedSingle(text: string): Promise<Float32Array> {
    const [result] = await this.embed([text]);
    return new Float32Array(result!);
  }
}
