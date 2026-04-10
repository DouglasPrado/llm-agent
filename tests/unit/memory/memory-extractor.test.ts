import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  hasExplicitTrigger,
  shouldExtract,
  extractMemories,
  type ForkFn,
} from '../../../src/memory/memory-extractor.js';
import { FileMemorySystem } from '../../../src/memory/file-memory-system.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';
import type { Logger } from '../../../src/utils/logger.js';

function createMockClient(): LLMClient {
  return {
    chat: vi.fn().mockResolvedValue({ content: '[]' }),
  } as unknown as LLMClient;
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe('memory-extractor', () => {
  describe('hasExplicitTrigger', () => {
    it('should detect English triggers', () => {
      expect(hasExplicitTrigger('Please remember that I like dark mode')).toBe(true);
      expect(hasExplicitTrigger('Keep in mind I use vim')).toBe(true);
      expect(hasExplicitTrigger('For future reference, the API key is X')).toBe(true);
    });

    it('should detect Portuguese triggers', () => {
      expect(hasExplicitTrigger('Lembra que eu gosto de TypeScript')).toBe(true);
      expect(hasExplicitTrigger('Não esqueça de usar testes')).toBe(true);
    });

    it('should return false for normal messages', () => {
      expect(hasExplicitTrigger('How do I fix this bug?')).toBe(false);
      expect(hasExplicitTrigger('Write a function')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(hasExplicitTrigger('REMEMBER THAT I prefer tabs')).toBe(true);
    });
  });

  describe('shouldExtract', () => {
    it('should return true on explicit trigger', () => {
      expect(shouldExtract('remember that I use vim', 0, {})).toBe(true);
    });

    it('should return true when turn interval exceeded', () => {
      expect(shouldExtract('normal message', 10, { extractionInterval: 10 })).toBe(true);
    });

    it('should return false when interval not reached and no trigger', () => {
      expect(shouldExtract('normal message', 2, { samplingRate: 0 })).toBe(false);
    });
  });

  describe('extractMemories (forked agent)', () => {
    let tempDir: string;
    let system: FileMemorySystem;
    let logger: Logger;
    let mockFork: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'extract-test-'));
      logger = createMockLogger();
      const client = createMockClient();
      system = new FileMemorySystem({ memoryDir: tempDir }, client, logger);
      mockFork = vi.fn().mockResolvedValue('');
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('calls fork with memory tools', async () => {
      await extractMemories(
        'user: I like TypeScript\nassistant: Great!',
        system,
        mockFork as ForkFn,
      );

      expect(mockFork).toHaveBeenCalledOnce();

      const [prompt, options] = mockFork.mock.calls[0];
      expect(prompt).toContain('memory extraction');
      expect(options.tools).toHaveLength(5);

      const toolNames = options.tools.map((t: any) => t.name);
      expect(toolNames).toContain('memory_list');
      expect(toolNames).toContain('memory_read');
      expect(toolNames).toContain('memory_write');
      expect(toolNames).toContain('memory_edit');
      expect(toolNames).toContain('memory_delete');
    });

    it('passes existing manifest in prompt', async () => {
      // Create a memory file so manifest is non-empty
      await system.saveMemory({
        name: 'Existing Memory',
        description: 'A pre-existing memory',
        type: 'user',
        content: 'Some content.',
      });

      await extractMemories(
        'user: hello\nassistant: hi',
        system,
        mockFork as ForkFn,
      );

      const [prompt] = mockFork.mock.calls[0];
      expect(prompt).toContain('existing-memory.md');
      expect(prompt).toContain('A pre-existing memory');
    });

    it('runs fork in background mode', async () => {
      await extractMemories(
        'user: test\nassistant: ok',
        system,
        mockFork as ForkFn,
      );

      const [, options] = mockFork.mock.calls[0];
      expect(options.background).toBe(true);
    });

    it('does nothing on empty conversation', async () => {
      await extractMemories('', system, mockFork as ForkFn);
      expect(mockFork).not.toHaveBeenCalled();
    });

    it('does nothing on whitespace-only conversation', async () => {
      await extractMemories('   \n  \n  ', system, mockFork as ForkFn);
      expect(mockFork).not.toHaveBeenCalled();
    });

    it('swallows errors gracefully', async () => {
      const failingFork = vi.fn().mockRejectedValue(new Error('fork failed'));

      // Should not throw
      await extractMemories(
        'user: test\nassistant: ok',
        system,
        failingFork as ForkFn,
      );
    });

    it('passes threadId to memory tools when provided', async () => {
      await extractMemories(
        'user: test\nassistant: ok',
        system,
        mockFork as ForkFn,
        { threadId: 'thread-42' },
      );

      expect(mockFork).toHaveBeenCalledOnce();
    });

    it('includes conversation text in the prompt', async () => {
      await extractMemories(
        'user: I prefer dark mode\nassistant: Noted!',
        system,
        mockFork as ForkFn,
      );

      const [prompt] = mockFork.mock.calls[0];
      expect(prompt).toContain('I prefer dark mode');
    });
  });
});
