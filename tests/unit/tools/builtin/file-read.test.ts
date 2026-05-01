import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileReadTool } from '../../../../src/tools/builtin/file-read.js';

describe('builtin/file-read', () => {
  let tempDir: string;
  const signal = new AbortController().signal;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fread-tool-'));
    await writeFile(join(tempDir, 'test.txt'), 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return AgentTool with correct metadata', () => {
    const tool = createFileReadTool();
    expect(tool.name).toBe('Read');
    expect(tool.isConcurrencySafe).toBe(true);
    expect(tool.isReadOnly).toBe(true);
    expect(tool.getFilePath).toBeDefined();
  });

  it('should read file with line numbers', async () => {
    const tool = createFileReadTool();
    const result = await tool.execute({ file_path: join(tempDir, 'test.txt') }, signal);
    const content = typeof result === 'string' ? result : result.content;
    expect(content).toContain('1\tLine 1');
    expect(content).toContain('5\tLine 5');
  });

  it('should support offset and limit', async () => {
    const tool = createFileReadTool();
    const result = await tool.execute({ file_path: join(tempDir, 'test.txt'), offset: 2, limit: 2 }, signal);
    const content = typeof result === 'string' ? result : result.content;
    expect(content).toContain('Line 2');
    expect(content).toContain('Line 3');
    expect(content).not.toContain('Line 1');
    expect(content).not.toContain('Line 4');
  });

  it('should return error for non-existent file', async () => {
    const tool = createFileReadTool();
    const result = await tool.execute({ file_path: join(tempDir, 'nope.txt') }, signal);
    const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
    expect(parsed.isError).toBe(true);
  });

  it('should extract file path', () => {
    const tool = createFileReadTool();
    expect(tool.getFilePath!({ file_path: '/foo/bar.ts' })).toBe('/foo/bar.ts');
  });

  // --- issue #50: path containment for createFileReadTool ---

  describe('workingDir path containment (issue #50)', () => {
    it('blocks reading a file outside workingDir when workingDir is set', async () => {
      const tool = createFileReadTool(tempDir);
      const outsidePath = '/etc/passwd';
      const result = await tool.execute({ file_path: outsidePath }, signal);
      const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(parsed.isError).toBe(true);
      expect(parsed.content).toMatch(/traversal|outside|blocked/i);
    });

    it('allows reading a file inside workingDir when workingDir is set', async () => {
      const tool = createFileReadTool(tempDir);
      const result = await tool.execute({ file_path: join(tempDir, 'test.txt') }, signal);
      const content = typeof result === 'string' ? result : result.content;
      expect(content).toContain('Line 1');
    });

    it('blocks path traversal via .. when workingDir is set', async () => {
      const tool = createFileReadTool(tempDir);
      const escapePath = join(tempDir, '..', 'secret.txt');
      const result = await tool.execute({ file_path: escapePath }, signal);
      const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(parsed.isError).toBe(true);
    });

    it('has no path restriction when workingDir is not set', async () => {
      const tool = createFileReadTool(); // no restriction
      const result = await tool.execute({ file_path: join(tempDir, 'test.txt') }, signal);
      const content = typeof result === 'string' ? result : result.content;
      expect(content).toContain('Line 1');
    });
  });
});
