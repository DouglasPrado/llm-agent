import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileMemorySystem } from '../../../src/memory/file-memory-system.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';
import type { Logger } from '../../../src/utils/logger.js';
import { vi } from 'vitest';

function createMockClient(selectedMemories: string[] = []): LLMClient {
  return {
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({ selected_memories: selectedMemories }),
    }),
  } as unknown as LLMClient;
}

function createMockLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

describe('Memory Thread Isolation', () => {
  let tempDir: string;
  let system: FileMemorySystem;
  let client: LLMClient;
  let logger: Logger;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mem-thread-'));
    client = createMockClient();
    logger = createMockLogger();
    system = new FileMemorySystem({ memoryDir: tempDir }, client, logger);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should save memory to thread subdirectory', async () => {
    const filename = await system.saveMemory({
      name: 'User Name',
      description: 'User is Douglas',
      type: 'user',
      content: 'The user is called Douglas.',
    }, 'telegram-123');

    // File should exist in thread subdir
    const threadDir = join(tempDir, 'threads', 'telegram-123');
    const entries = await readdir(threadDir);
    expect(entries).toContain(filename);
  });

  it('should save memory globally when no threadId', async () => {
    const filename = await system.saveMemory({
      name: 'Project Info',
      description: 'Project deadline',
      type: 'project',
      content: 'Deadline is March 5.',
    });

    // File should exist in root memoryDir
    const entries = await readdir(tempDir);
    expect(entries).toContain(filename);
  });

  it('should scan only thread + global memories', async () => {
    // Save global memory
    await system.saveMemory({
      name: 'Global Fact',
      description: 'A global fact',
      type: 'project',
      content: 'Global.',
    });

    // Save thread-A memory
    await system.saveMemory({
      name: 'Thread A Fact',
      description: 'A fact for thread A',
      type: 'user',
      content: 'Thread A user.',
    }, 'thread-a');

    // Save thread-B memory
    await system.saveMemory({
      name: 'Thread B Fact',
      description: 'A fact for thread B',
      type: 'user',
      content: 'Thread B user.',
    }, 'thread-b');

    // Scan for thread-A should see global + thread-A, NOT thread-B
    const memoriesA = await system.scanMemories(undefined, 'thread-a');
    const names = memoriesA.map(m => m.name);
    expect(names).toContain('Global Fact');
    expect(names).toContain('Thread A Fact');
    expect(names).not.toContain('Thread B Fact');
  });

  it('should read memory from thread directory', async () => {
    await system.saveMemory({
      name: 'Private',
      description: 'Private memory',
      type: 'user',
      content: 'Secret info.',
    }, 'thread-x');

    const memory = await system.readMemory('private.md', 'thread-x');
    expect(memory).not.toBeNull();
    expect(memory!.content).toBe('Secret info.');
  });

  it('should delete memory from thread directory', async () => {
    const filename = await system.saveMemory({
      name: 'To Delete',
      description: 'Will be deleted',
      type: 'feedback',
      content: 'temp.',
    }, 'thread-del');

    const deleted = await system.deleteMemory(filename, 'thread-del');
    expect(deleted).toBe(true);

    const memory = await system.readMemory(filename, 'thread-del');
    expect(memory).toBeNull();
  });

  it('should maintain separate MEMORY.md per thread', async () => {
    await system.saveMemory({
      name: 'Global',
      description: 'Global mem',
      type: 'project',
      content: 'g',
    });

    await system.saveMemory({
      name: 'Thread Mem',
      description: 'Thread specific',
      type: 'user',
      content: 't',
    }, 'thread-idx');

    // Global MEMORY.md should have global entry
    const globalIndex = await readFile(join(tempDir, 'MEMORY.md'), 'utf-8');
    expect(globalIndex).toContain('global.md');
    expect(globalIndex).not.toContain('thread-mem.md');

    // Thread MEMORY.md should have thread entry
    const threadIndex = await readFile(join(tempDir, 'threads', 'thread-idx', 'MEMORY.md'), 'utf-8');
    expect(threadIndex).toContain('thread-mem.md');
  });

  it('should check hasWritesSince for specific thread', async () => {
    const before = Date.now();
    await new Promise(r => setTimeout(r, 10));

    await system.saveMemory({
      name: 'Recent',
      description: 'recent',
      type: 'user',
      content: 'r',
    }, 'thread-hw');

    const has = await system.hasWritesSince(before, 'thread-hw');
    expect(has).toBe(true);

    // Different thread should NOT have writes
    const hasOther = await system.hasWritesSince(before, 'thread-other');
    expect(hasOther).toBe(false);
  });

  it('should build context prompt merging global + thread MEMORY.md', async () => {
    await system.saveMemory({ name: 'G', description: 'global', type: 'project', content: 'g' });
    await system.saveMemory({ name: 'T', description: 'thread', type: 'user', content: 't' }, 'thread-ctx');

    const prompt = await system.buildContextPrompt('thread-ctx');
    expect(prompt).toContain('global');
    expect(prompt).toContain('thread');
  });
});
