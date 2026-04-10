import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileMemorySystem, truncateEntrypointContent } from '../../../src/memory/file-memory-system.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';
import type { Logger } from '../../../src/utils/logger.js';

function createMockClient(selectedMemories: string[] = []): LLMClient {
  return {
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({ selected_memories: selectedMemories }),
    }),
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

describe('FileMemorySystem', () => {
  let tempDir: string;
  let system: FileMemorySystem;
  let client: LLMClient;
  let logger: Logger;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fms-test-'));
    client = createMockClient();
    logger = createMockLogger();
    system = new FileMemorySystem({ memoryDir: tempDir }, client, logger);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('ensureDir', () => {
    it('should create memory directory', async () => {
      const newDir = join(tempDir, 'sub', 'memory');
      const s = new FileMemorySystem({ memoryDir: newDir }, client, logger);
      await s.ensureDir();

      const { stat } = await import('node:fs/promises');
      const dirStat = await stat(newDir);
      expect(dirStat.isDirectory()).toBe(true);
    });
  });

  describe('saveMemory', () => {
    it('should create a memory file with frontmatter', async () => {
      const filename = await system.saveMemory({
        name: 'User Role',
        description: 'User is a data scientist',
        type: 'user',
        content: 'The user works as a data scientist focused on ML.',
      });

      expect(filename).toBe('user-role.md');

      const content = await readFile(join(tempDir, filename), 'utf-8');
      expect(content).toContain('---');
      expect(content).toContain('name: User Role');
      expect(content).toContain('description: User is a data scientist');
      expect(content).toContain('type: user');
      expect(content).toContain('The user works as a data scientist');
    });

    it('should update MEMORY.md index', async () => {
      await system.saveMemory({
        name: 'Test Memory',
        description: 'A test',
        type: 'feedback',
        content: 'Content',
      });

      const index = await readFile(join(tempDir, 'MEMORY.md'), 'utf-8');
      expect(index).toContain('test-memory.md');
      expect(index).toContain('A test');
    });

    it('should not duplicate index entries', async () => {
      await system.saveMemory({
        name: 'Test',
        description: 'desc',
        type: 'project',
        content: 'c',
      });
      await system.saveMemory({
        name: 'Test',
        description: 'desc updated',
        type: 'project',
        content: 'c2',
      });

      const index = await readFile(join(tempDir, 'MEMORY.md'), 'utf-8');
      const matches = index.match(/test\.md/g);
      expect(matches?.length).toBe(1);
    });
  });

  describe('readMemory', () => {
    it('should read and parse a memory file', async () => {
      await writeFile(
        join(tempDir, 'test.md'),
        '---\nname: Test\ndescription: A test\ntype: user\n---\n\nBody content here',
      );

      const result = await system.readMemory('test.md');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Test');
      expect(result!.description).toBe('A test');
      expect(result!.type).toBe('user');
      expect(result!.content).toBe('Body content here');
    });

    it('should return null for non-existent file', async () => {
      const result = await system.readMemory('nonexistent.md');
      expect(result).toBeNull();
    });
  });

  describe('deleteMemory', () => {
    it('should delete the file and remove from index', async () => {
      const filename = await system.saveMemory({
        name: 'To Delete',
        description: 'Will be deleted',
        type: 'reference',
        content: 'temp',
      });

      const deleted = await system.deleteMemory(filename);
      expect(deleted).toBe(true);

      const result = await system.readMemory(filename);
      expect(result).toBeNull();

      const index = await readFile(join(tempDir, 'MEMORY.md'), 'utf-8');
      expect(index).not.toContain(filename);
    });

    it('should return false for non-existent file', async () => {
      const deleted = await system.deleteMemory('nonexistent.md');
      expect(deleted).toBe(false);
    });
  });

  describe('scanMemories', () => {
    it('should scan all memory files', async () => {
      await writeFile(join(tempDir, 'a.md'), '---\nname: A\ntype: user\n---\n');
      await writeFile(join(tempDir, 'b.md'), '---\nname: B\ntype: feedback\n---\n');

      const result = await system.scanMemories();
      expect(result).toHaveLength(2);
    });
  });

  describe('findRelevant', () => {
    it('should return memory files selected by LLM', async () => {
      await writeFile(
        join(tempDir, 'relevant.md'),
        '---\nname: Relevant\ndescription: Very relevant\ntype: user\n---\n\nRelevant content',
      );
      await writeFile(
        join(tempDir, 'other.md'),
        '---\nname: Other\ndescription: Not relevant\ntype: project\n---\n\nOther content',
      );

      client = createMockClient(['relevant.md']);
      system = new FileMemorySystem({ memoryDir: tempDir }, client, logger);

      const result = await system.findRelevant('find relevant stuff');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Relevant');
      expect(result[0].content).toBe('Relevant content');
    });

    it('should return empty array when no memories exist', async () => {
      const result = await system.findRelevant('query');
      expect(result).toEqual([]);
    });
  });

  describe('buildContextPrompt', () => {
    it('should return MEMORY.md content', async () => {
      await writeFile(
        join(tempDir, 'MEMORY.md'),
        '- [Test](test.md) — A test memory\n',
      );

      const result = await system.buildContextPrompt();
      expect(result).toContain('test.md');
      expect(result).toContain('A test memory');
    });

    it('should return empty string when no MEMORY.md', async () => {
      const result = await system.buildContextPrompt();
      expect(result).toBe('');
    });
  });

  describe('buildFullContext', () => {
    it('should combine index and relevant memories', async () => {
      await writeFile(join(tempDir, 'MEMORY.md'), '- [Test](test.md) — test\n');
      await writeFile(
        join(tempDir, 'test.md'),
        '---\nname: Test\ndescription: test\ntype: user\n---\n\nTest body',
      );

      client = createMockClient(['test.md']);
      system = new FileMemorySystem({ memoryDir: tempDir }, client, logger);

      const result = await system.buildFullContext('query');
      expect(result).toContain('Memory Index');
      expect(result).toContain('Relevant Memories');
      expect(result).toContain('Test body');
    });
  });
});

describe('truncateEntrypointContent', () => {
  it('should return content as-is when within limits', () => {
    const content = 'Line 1\nLine 2\nLine 3';
    expect(truncateEntrypointContent(content)).toBe(content);
  });

  it('should truncate at 200 lines', () => {
    const lines = Array.from({ length: 250 }, (_, i) => `Line ${i + 1}`);
    const content = lines.join('\n');
    const result = truncateEntrypointContent(content);
    expect(result).toContain('Line 200');
    expect(result).not.toContain('Line 201');
    expect(result).toContain('truncated');
    expect(result).toContain('50 more lines');
  });

  it('should truncate at 25KB', () => {
    // Create content just over 25KB
    const line = 'x'.repeat(500) + '\n';
    const content = line.repeat(60); // ~30KB
    const result = truncateEntrypointContent(content);
    const bytes = new TextEncoder().encode(result.split('\n\n[...')[0]).length;
    expect(bytes).toBeLessThanOrEqual(25_000);
    expect(result).toContain('truncated');
  });
});
