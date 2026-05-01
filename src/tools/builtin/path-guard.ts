import { resolve, relative, isAbsolute, dirname, basename } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';

/**
 * Resolve symlinks starting from the deepest existing path component.
 * Handles paths that don't yet exist by walking up to the nearest existing ancestor.
 */
function resolveReal(p: string): string {
  if (existsSync(p)) return realpathSync(p);
  const parent = dirname(p);
  if (parent === p) return p; // filesystem root
  return resolve(resolveReal(parent), basename(p));
}

/**
 * Asserts that filePath is contained within rootDir.
 * Throws if the resolved path (including symlinks) escapes the root.
 */
export function assertSafePath(filePath: string, rootDir: string): void {
  const abs = resolve(filePath);
  const rel = relative(rootDir, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path traversal blocked: "${filePath}" is outside working directory "${rootDir}"`);
  }
  // Resolve symlinks to catch traversal via symlinks inside workDir
  const real = resolveReal(abs);
  const realRel = relative(rootDir, real);
  if (realRel.startsWith('..') || isAbsolute(realRel)) {
    throw new Error(`Path traversal via symlink blocked: "${filePath}" resolves outside working directory "${rootDir}"`);
  }
}
