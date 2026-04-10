import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingService } from '../../../src/knowledge/embedding-service.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';

function createMockClient(embedResult?: number[][]): LLMClient {
  return {
    embed: vi.fn().mockResolvedValue(embedResult ?? [[0.1, 0.2], [0.3, 0.4]]),
  } as unknown as LLMClient;
}

describe('EmbeddingService', () => {
  let client: LLMClient;
  let service: EmbeddingService;

  beforeEach(() => {
    client = createMockClient();
    service = new EmbeddingService(client);
  });

  describe('constructor', () => {
    it('should accept default options', () => {
      const svc = new EmbeddingService(client);
      expect(svc).toBeInstanceOf(EmbeddingService);
    });

    it('should accept custom model and cacheSize', () => {
      const svc = new EmbeddingService(client, { model: 'text-embed-3', cacheSize: 500 });
      expect(svc).toBeInstanceOf(EmbeddingService);
    });
  });

  describe('embed()', () => {
    it('should call client.embed for uncached texts', async () => {
      const results = await service.embed(['hello', 'world']);

      expect(client.embed).toHaveBeenCalledWith(['hello', 'world'], undefined);
      expect(results).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    });

    it('should pass custom model to client.embed', async () => {
      const svc = new EmbeddingService(client, { model: 'custom-model' });
      await svc.embed(['test']);

      expect(client.embed).toHaveBeenCalledWith(['test'], 'custom-model');
    });

    it('should return cached results on second call', async () => {
      await service.embed(['hello', 'world']);
      vi.mocked(client.embed).mockClear();

      const results = await service.embed(['hello', 'world']);

      expect(client.embed).not.toHaveBeenCalled();
      expect(results).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    });

    it('should only fetch uncached texts on partial cache hit', async () => {
      // First call caches "hello" and "world"
      await service.embed(['hello', 'world']);
      vi.mocked(client.embed).mockClear();

      // Second call: "hello" cached, "new" uncached
      vi.mocked(client.embed).mockResolvedValueOnce([[0.9, 0.8]]);
      const results = await service.embed(['hello', 'new']);

      expect(client.embed).toHaveBeenCalledWith(['new'], undefined);
      expect(results[0]).toEqual([0.1, 0.2]); // cached
      expect(results[1]).toEqual([0.9, 0.8]); // fetched
    });

    it('should handle empty input array', async () => {
      const results = await service.embed([]);

      expect(client.embed).not.toHaveBeenCalled();
      expect(results).toEqual([]);
    });

    it('should handle single text input', async () => {
      vi.mocked(client.embed).mockResolvedValueOnce([[0.5, 0.6, 0.7]]);
      const results = await service.embed(['single']);

      expect(client.embed).toHaveBeenCalledWith(['single'], undefined);
      expect(results).toEqual([[0.5, 0.6, 0.7]]);
    });
  });

  describe('embedSingle()', () => {
    it('should return Float32Array for a single text', async () => {
      vi.mocked(client.embed).mockResolvedValueOnce([[0.1, 0.2, 0.3]]);

      const result = await service.embedSingle('hello');

      expect(result).toBeInstanceOf(Float32Array);
      expect(Array.from(result)).toEqual([
        expect.closeTo(0.1, 5),
        expect.closeTo(0.2, 5),
        expect.closeTo(0.3, 5),
      ]);
    });

    it('should use cache on repeated calls', async () => {
      vi.mocked(client.embed).mockResolvedValueOnce([[0.4, 0.5]]);

      await service.embedSingle('cached-text');
      vi.mocked(client.embed).mockClear();

      const result = await service.embedSingle('cached-text');

      expect(client.embed).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(Float32Array);
      expect(Array.from(result)).toEqual([
        expect.closeTo(0.4, 5),
        expect.closeTo(0.5, 5),
      ]);
    });
  });
});
