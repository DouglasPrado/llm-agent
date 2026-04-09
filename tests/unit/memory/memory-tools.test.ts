import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryTools } from '../../../src/memory/memory-tools.js';
import type { AgentTool } from '../../../src/contracts/entities/agent-tool.js';

function findTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find(t => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

const signal = new AbortController().signal;

describe('memory-tools', () => {
  let tempDir: string;
  let tools: AgentTool[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'memtools-test-'));
    tools = createMemoryTools(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('memory_list', () => {
    it('returns empty list when no memories exist', async () => {
      const tool = findTool(tools, 'memory_list');
      const result = await tool.execute({}, signal);
      expect(result).toContain('No memory files found');
    });

    it('returns manifest of existing memories', async () => {
      await writeFile(join(tempDir, 'user-role.md'), [
        '---',
        'name: User Role',
        'description: User is a data scientist',
        'type: user',
        '---',
        '',
        'The user is a data scientist.',
      ].join('\n'));

      const tool = findTool(tools, 'memory_list');
      const result = await tool.execute({}, signal);
      const text = typeof result === 'string' ? result : result.content;
      expect(text).toContain('user-role.md');
      expect(text).toContain('User is a data scientist');
    });
  });

  describe('memory_read', () => {
    it('reads content of existing memory file', async () => {
      const content = '---\nname: Test\ndescription: test\ntype: user\n---\n\nHello world.';
      await writeFile(join(tempDir, 'test.md'), content);

      const tool = findTool(tools, 'memory_read');
      const result = await tool.execute({ filename: 'test.md' }, signal);
      const text = typeof result === 'string' ? result : result.content;
      expect(text).toContain('Hello world');
    });

    it('returns error for nonexistent file', async () => {
      const tool = findTool(tools, 'memory_read');
      const result = await tool.execute({ filename: 'nope.md' }, signal);
      const res = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(res.isError).toBe(true);
    });

    it('rejects path traversal', async () => {
      const tool = findTool(tools, 'memory_read');
      const result = await tool.execute({ filename: '../../../etc/passwd' }, signal);
      const res = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(res.isError).toBe(true);
    });

    it('rejects MEMORY.md', async () => {
      const tool = findTool(tools, 'memory_read');
      const result = await tool.execute({ filename: 'MEMORY.md' }, signal);
      const res = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(res.isError).toBe(true);
    });
  });

  describe('memory_write', () => {
    it('creates a new memory file with frontmatter', async () => {
      const tool = findTool(tools, 'memory_write');
      const result = await tool.execute({
        name: 'User Role',
        description: 'User is a Go developer',
        type: 'user',
        content: 'The user has 10 years of Go experience.',
      }, signal);

      const text = typeof result === 'string' ? result : result.content;
      expect(text).toContain('user-role.md');

      const fileContent = await readFile(join(tempDir, 'user-role.md'), 'utf-8');
      expect(fileContent).toContain('name: User Role');
      expect(fileContent).toContain('type: user');
      expect(fileContent).toContain('10 years of Go experience');
    });

    it('updates MEMORY.md index', async () => {
      const tool = findTool(tools, 'memory_write');
      await tool.execute({
        name: 'Feedback',
        description: 'Use TDD always',
        type: 'feedback',
        content: 'The user wants TDD.',
      }, signal);

      const index = await readFile(join(tempDir, 'MEMORY.md'), 'utf-8');
      expect(index).toContain('feedback.md');
    });
  });

  describe('memory_edit', () => {
    it('updates content of existing memory file', async () => {
      await writeFile(join(tempDir, 'user-role.md'), [
        '---',
        'name: User Role',
        'description: User is a dev',
        'type: user',
        '---',
        '',
        'Old content.',
      ].join('\n'));

      const tool = findTool(tools, 'memory_edit');
      const result = await tool.execute({
        filename: 'user-role.md',
        content: 'Updated: user is a senior Go developer with 10 years experience.',
      }, signal);

      const text = typeof result === 'string' ? result : result.content;
      expect(text).toContain('updated');

      const fileContent = await readFile(join(tempDir, 'user-role.md'), 'utf-8');
      expect(fileContent).toContain('senior Go developer');
      expect(fileContent).not.toContain('Old content');
    });

    it('returns error for nonexistent file', async () => {
      const tool = findTool(tools, 'memory_edit');
      const result = await tool.execute({
        filename: 'nope.md',
        content: 'new content',
      }, signal);
      const res = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(res.isError).toBe(true);
    });

    it('allows updating description and name', async () => {
      await writeFile(join(tempDir, 'test.md'), [
        '---',
        'name: Old Name',
        'description: Old desc',
        'type: user',
        '---',
        '',
        'Old body.',
      ].join('\n'));

      const tool = findTool(tools, 'memory_edit');
      await tool.execute({
        filename: 'test.md',
        content: 'New body.',
        name: 'New Name',
        description: 'New desc',
      }, signal);

      const fileContent = await readFile(join(tempDir, 'test.md'), 'utf-8');
      expect(fileContent).toContain('name: New Name');
      expect(fileContent).toContain('description: New desc');
      expect(fileContent).toContain('New body.');
    });
  });

  describe('memory_delete', () => {
    it('deletes existing memory file', async () => {
      await writeFile(join(tempDir, 'temp.md'), '---\nname: Temp\n---\n\nTemp.');
      await writeFile(join(tempDir, 'MEMORY.md'), '- [Temp](temp.md) — temp\n');

      const tool = findTool(tools, 'memory_delete');
      const result = await tool.execute({ filename: 'temp.md' }, signal);
      const text = typeof result === 'string' ? result : result.content;
      expect(text).toContain('deleted');

      // File should be gone
      await expect(readFile(join(tempDir, 'temp.md'), 'utf-8')).rejects.toThrow();

      // Index should be updated
      const index = await readFile(join(tempDir, 'MEMORY.md'), 'utf-8');
      expect(index).not.toContain('temp.md');
    });

    it('rejects MEMORY.md deletion', async () => {
      const tool = findTool(tools, 'memory_delete');
      const result = await tool.execute({ filename: 'MEMORY.md' }, signal);
      const res = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(res.isError).toBe(true);
    });
  });

  describe('thread-scoped tools', () => {
    it('operates within thread subdirectory', async () => {
      const threadDir = join(tempDir, 'threads', 'thread-42');
      await mkdir(threadDir, { recursive: true });

      const threadTools = createMemoryTools(tempDir, 'thread-42');
      const writeTool = findTool(threadTools, 'memory_write');

      await writeTool.execute({
        name: 'Thread Memory',
        description: 'A thread-scoped memory',
        type: 'project',
        content: 'Thread-specific info.',
      }, signal);

      const fileContent = await readFile(join(threadDir, 'thread-memory.md'), 'utf-8');
      expect(fileContent).toContain('Thread-specific info');
    });
  });
});
