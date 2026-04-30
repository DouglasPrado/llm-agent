import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileEditTool } from '../../../../src/tools/builtin/file-edit.js';

describe('builtin/file-edit', () => {
  let tempDir: string;
  const signal = new AbortController().signal;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fedit-tool-'));
    await writeFile(join(tempDir, 'code.ts'), 'function hello() {\n  return "world";\n}\n');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return AgentTool with correct metadata', () => {
    const tool = createFileEditTool();
    expect(tool.name).toBe('Edit');
    expect(tool.getFilePath).toBeDefined();
  });

  it('should replace exact string match', async () => {
    const tool = createFileEditTool();
    await tool.execute({
      file_path: join(tempDir, 'code.ts'),
      old_string: 'return "world"',
      new_string: 'return "hello"',
    }, signal);

    const content = await readFile(join(tempDir, 'code.ts'), 'utf-8');
    expect(content).toContain('return "hello"');
    expect(content).not.toContain('return "world"');
  });

  it('should fail if old_string not found', async () => {
    const tool = createFileEditTool();
    const result = await tool.execute({
      file_path: join(tempDir, 'code.ts'),
      old_string: 'nonexistent string',
      new_string: 'replacement',
    }, signal);

    const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
    expect(parsed.isError).toBe(true);
    expect(parsed.content).toContain('not found');
  });

  it('should fail if old_string matches multiple times without replace_all', async () => {
    await writeFile(join(tempDir, 'dup.ts'), 'foo\nbar\nfoo\n');
    const tool = createFileEditTool();
    const result = await tool.execute({
      file_path: join(tempDir, 'dup.ts'),
      old_string: 'foo',
      new_string: 'baz',
    }, signal);

    const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
    expect(parsed.isError).toBe(true);
    expect(parsed.content).toContain('multiple');
  });

  it('should replace all occurrences with replace_all', async () => {
    await writeFile(join(tempDir, 'dup.ts'), 'foo\nbar\nfoo\n');
    const tool = createFileEditTool();
    await tool.execute({
      file_path: join(tempDir, 'dup.ts'),
      old_string: 'foo',
      new_string: 'baz',
      replace_all: true,
    }, signal);

    const content = await readFile(join(tempDir, 'dup.ts'), 'utf-8');
    expect(content).toBe('baz\nbar\nbaz\n');
  });

  it('should return error for non-existent file', async () => {
    const tool = createFileEditTool();
    const result = await tool.execute({
      file_path: join(tempDir, 'nope.ts'),
      old_string: 'x',
      new_string: 'y',
    }, signal);

    const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
    expect(parsed.isError).toBe(true);
  });

  // --- issue #22: path traversal protection ---

  it('blocks path traversal outside workingDir', async () => {
    const tool = createFileEditTool(tempDir);
    const result = await tool.execute({
      file_path: join(tempDir, '..', 'code.ts'),
      old_string: 'x',
      new_string: 'y',
    }, signal);
    const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
    expect(parsed.isError).toBe(true);
    expect(parsed.content).toMatch(/[Tt]raversal|[Bb]locked|outside/);
  });

  it('blocks absolute path outside workingDir', async () => {
    const tool = createFileEditTool(tempDir);
    const result = await tool.execute({
      file_path: '/etc/hosts',
      old_string: 'localhost',
      new_string: 'evil',
    }, signal);
    const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
    expect(parsed.isError).toBe(true);
  });

  it('allows edit inside workingDir when workingDir is set', async () => {
    const tool = createFileEditTool(tempDir);
    const result = await tool.execute({
      file_path: join(tempDir, 'code.ts'),
      old_string: 'return "world"',
      new_string: 'return "hello"',
    }, signal);
    const content = typeof result === 'string' ? result : result.content;
    expect(content).not.toMatch(/[Tt]raversal|[Bb]locked/);
  });

  it('allows any path when no workingDir is set (backward compat)', async () => {
    const tool = createFileEditTool();
    const result = await tool.execute({
      file_path: join(tempDir, 'code.ts'),
      old_string: 'return "world"',
      new_string: 'return "hello"',
    }, signal);
    const content = typeof result === 'string' ? result : result.content;
    expect(content).not.toMatch(/[Tt]raversal|[Bb]locked/);
  });
});
