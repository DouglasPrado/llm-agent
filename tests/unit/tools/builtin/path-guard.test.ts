import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertSafePath } from '../../../../src/tools/builtin/path-guard.js';

describe('assertSafePath', () => {
  let workDir: string;
  let outsideDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'path-guard-work-'));
    outsideDir = await mkdtemp(join(tmpdir(), 'path-guard-outside-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  it('allows a regular file inside workDir', async () => {
    const file = join(workDir, 'safe.txt');
    await writeFile(file, 'ok');
    expect(() => assertSafePath(file, workDir)).not.toThrow();
  });

  it('blocks a path that escapes workDir via ..', () => {
    const escape = join(workDir, '..', 'etc', 'passwd');
    expect(() => assertSafePath(escape, workDir)).toThrow(/traversal|outside/i);
  });

  it('blocks an absolute path outside workDir', () => {
    expect(() => assertSafePath('/etc/passwd', workDir)).toThrow(/traversal|outside/i);
  });

  // --- issue #47: symlink traversal ---

  it('blocks a symlink inside workDir that points to a file outside (issue #47)', async () => {
    const targetFile = join(outsideDir, 'secret.txt');
    await writeFile(targetFile, 'sensitive');
    const link = join(workDir, 'safe-link.txt');
    await symlink(targetFile, link);
    // path.resolve('workDir/safe-link.txt') → 'workDir/safe-link.txt' (inside root)
    // BUT realpathSync follows the symlink → outsideDir/secret.txt (outside root)
    expect(() => assertSafePath(link, workDir)).toThrow(/symlink|traversal|outside/i);
  });

  it('blocks a symlink inside workDir that points to a directory outside (issue #47)', async () => {
    const link = join(workDir, 'outside-dir-link');
    await symlink(outsideDir, link);
    expect(() => assertSafePath(join(link, 'anything'), workDir)).toThrow(/symlink|traversal|outside/i);
  });
});
