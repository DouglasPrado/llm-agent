import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGlobTool } from '../../../../src/tools/builtin/glob.js';


describe('builtin/glob', () => {
  let tempDir: string;
  const signal = new AbortController().signal;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'glob-tool-'));
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await mkdir(join(tempDir, 'docs'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'index.ts'), 'export {}');
    await writeFile(join(tempDir, 'src', 'agent.ts'), 'class Agent {}');
    await writeFile(join(tempDir, 'docs', 'readme.md'), '# Docs');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return AgentTool with correct metadata', () => {
    const tool = createGlobTool();
    expect(tool.name).toBe('Glob');
    expect(tool.isConcurrencySafe).toBe(true);
    expect(tool.isReadOnly).toBe(true);
  });

  it('should find files matching pattern', async () => {
    const tool = createGlobTool();
    const result = await tool.execute({ pattern: '**/*.ts', path: tempDir }, signal);
    const content = typeof result === 'string' ? result : result.content;
    expect(content).toContain('index.ts');
    expect(content).toContain('agent.ts');
    expect(content).not.toContain('readme.md');
  });

  it('should respect path parameter', async () => {
    const tool = createGlobTool();
    const result = await tool.execute({ pattern: '*.md', path: join(tempDir, 'docs') }, signal);
    const content = typeof result === 'string' ? result : result.content;
    expect(content).toContain('readme.md');
  });

  it('should return empty for no matches', async () => {
    const tool = createGlobTool();
    const result = await tool.execute({ pattern: '**/*.py', path: tempDir }, signal);
    const content = typeof result === 'string' ? result : result.content;
    expect(content).toContain('No files found');
  });

  describe('path containment (issue #70)', () => {
    it('should block path outside workingDir when workingDir is set', async () => {
      const tool = createGlobTool(tempDir);
      const outsideDir = tmpdir();
      const result = await tool.execute({ pattern: '**/*', path: outsideDir }, signal);
      const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(parsed.isError).toBe(true);
      expect(parsed.content).toMatch(/traversal|outside|blocked/i);
    });

    it('should allow path inside workingDir when workingDir is set', async () => {
      const tool = createGlobTool(tempDir);
      const result = await tool.execute({ pattern: '**/*.ts', path: join(tempDir, 'src') }, signal);
      const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(parsed.isError).toBeFalsy();
    });

    it('should default to workingDir when no path is given and workingDir is set', async () => {
      const tool = createGlobTool(tempDir);
      const result = await tool.execute({ pattern: '**/*.ts' }, signal);
      const content = typeof result === 'string' ? result : result.content;
      expect(content).toContain('index.ts');
    });

    it('should be backward compatible when no workingDir is set', async () => {
      const tool = createGlobTool();
      const result = await tool.execute({ pattern: '**/*.ts', path: tempDir }, signal);
      const parsed = typeof result === 'string' ? { content: result, isError: false } : result;
      expect(parsed.isError).toBeFalsy();
    });
  });
});
