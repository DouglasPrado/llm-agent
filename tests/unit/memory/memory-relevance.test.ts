import { describe, it, expect, vi } from 'vitest';
import { selectRelevantMemories } from '../../../src/memory/memory-relevance.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';

function createMockClient(response: string): LLMClient {
  return {
    chat: vi.fn().mockResolvedValue({ content: response }),
  } as unknown as LLMClient;
}

function createErrorClient(): LLMClient {
  return {
    chat: vi.fn().mockRejectedValue(new Error('API error')),
  } as unknown as LLMClient;
}

describe('memory-relevance', () => {
  const manifest = `- [user] user_role.md (2026-01-15T10:00:00.000Z): Senior Go developer
- [feedback] feedback_testing.md (2026-01-14T10:00:00.000Z): Integration tests must use real DB
- [project] project_deadline.md (2026-01-13T10:00:00.000Z): Merge freeze on March 5`;

  const validFilenames = new Set([
    'user_role.md',
    'feedback_testing.md',
    'project_deadline.md',
  ]);

  it('should return selected filenames from LLM response', async () => {
    const client = createMockClient(
      JSON.stringify({ selected_memories: ['user_role.md', 'feedback_testing.md'] }),
    );

    const result = await selectRelevantMemories(
      'How should I write tests?',
      manifest,
      validFilenames,
      client,
    );

    expect(result).toEqual(['user_role.md', 'feedback_testing.md']);
  });

  it('should filter out invalid filenames', async () => {
    const client = createMockClient(
      JSON.stringify({ selected_memories: ['user_role.md', 'nonexistent.md'] }),
    );

    const result = await selectRelevantMemories(
      'query',
      manifest,
      validFilenames,
      client,
    );

    expect(result).toEqual(['user_role.md']);
  });

  it('should return max 5 results', async () => {
    const manyFiles = Array.from({ length: 10 }, (_, i) => `file${i}.md`);
    const client = createMockClient(
      JSON.stringify({ selected_memories: manyFiles }),
    );
    const allValid = new Set(manyFiles);

    const result = await selectRelevantMemories('query', manifest, allValid, client);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('should return empty array on empty manifest', async () => {
    const client = createMockClient('{}');
    const result = await selectRelevantMemories('query', '', validFilenames, client);
    expect(result).toEqual([]);
    expect(client.chat).not.toHaveBeenCalled();
  });

  it('should return empty array on LLM error', async () => {
    const client = createErrorClient();
    const result = await selectRelevantMemories('query', manifest, validFilenames, client);
    expect(result).toEqual([]);
  });

  it('should return empty array on invalid JSON response', async () => {
    const client = createMockClient('not json');
    const result = await selectRelevantMemories('query', manifest, validFilenames, client);
    expect(result).toEqual([]);
  });

  it('should return empty array when selected_memories is not an array', async () => {
    const client = createMockClient(JSON.stringify({ selected_memories: 'not array' }));
    const result = await selectRelevantMemories('query', manifest, validFilenames, client);
    expect(result).toEqual([]);
  });

  it('should pass model option to client', async () => {
    const client = createMockClient(JSON.stringify({ selected_memories: [] }));
    await selectRelevantMemories('query', manifest, validFilenames, client, {
      model: 'anthropic/claude-sonnet-4-20250514',
    });

    expect(client.chat).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'anthropic/claude-sonnet-4-20250514' }),
    );
  });
});
