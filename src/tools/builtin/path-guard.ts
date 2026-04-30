import { resolve, relative, isAbsolute } from 'node:path';

/**
 * Asserts that filePath is contained within rootDir.
 * Throws if the resolved path escapes the root (path traversal).
 */
export function assertSafePath(filePath: string, rootDir: string): void {
  const abs = resolve(filePath);
  const rel = relative(rootDir, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path traversal blocked: "${filePath}" is outside working directory "${rootDir}"`);
  }
}
