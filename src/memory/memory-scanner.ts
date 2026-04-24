/**
 * Memory directory scanning — reads .md files, parses frontmatter,
 * returns headers sorted by mtime (newest first), capped at MAX_MEMORY_FILES.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  type MemoryHeader,
  type MemoryFrontmatter,
  parseMemoryType,
  ENTRYPOINT_NAME,
  MAX_MEMORY_FILES,
} from './memory-types.js';

const FRONTMATTER_MAX_LINES = 30;

/**
 * Parse YAML frontmatter from markdown content.
 * Handles name, description, type fields. Robust against special
 * characters in values (colons, braces, globs, etc).
 */
export function parseFrontmatter(content: string): MemoryFrontmatter {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match?.[1]) return {};

  const yaml = match[1];
  const result: MemoryFrontmatter = {};

  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (key !== 'name' && key !== 'description' && key !== 'type' && key !== 'pinned') continue;

    let value = line.slice(colonIdx + 1).trim();

    // Strip matching quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Handle YAML special characters that may have been escaped
    value = value.replace(/\\"/g, '"').replace(/\\'/g, "'");

    if (key === 'name') result.name = value;
    if (key === 'description') result.description = value;
    if (key === 'type') result.type = value;
    if (key === 'pinned') result.pinned = value === 'true' || value === 'yes' || value === '1';
  }

  return result;
}

/**
 * Scan a memory directory for .md files, read their frontmatter, and return
 * a header list sorted newest-first (capped at MAX_MEMORY_FILES).
 */
export async function scanMemoryFiles(
  memoryDir: string,
  signal?: AbortSignal,
): Promise<MemoryHeader[]> {
  try {
    if (signal?.aborted) return [];
    const entries = await readdir(memoryDir, { recursive: true });
    const mdFiles = entries.filter(
      f => f.endsWith('.md')
        && basename(f) !== ENTRYPOINT_NAME
        && !f.startsWith('threads/') && !f.startsWith('threads\\'),
    );

    const headerResults = await Promise.allSettled(
      mdFiles.map(async (relativePath): Promise<MemoryHeader> => {
        if (signal?.aborted) throw new Error('Aborted');
        const filePath = join(memoryDir, relativePath);
        const [fileContent, fileStat] = await Promise.all([
          readFile(filePath, 'utf-8'),
          stat(filePath),
        ]);

        // Only parse first N lines for frontmatter
        const lines = fileContent.split('\n').slice(0, FRONTMATTER_MAX_LINES);
        const frontmatter = parseFrontmatter(lines.join('\n'));

        return {
          filename: relativePath,
          filePath,
          mtimeMs: fileStat.mtimeMs,
          name: frontmatter.name ?? null,
          description: frontmatter.description ?? null,
          type: parseMemoryType(frontmatter.type),
          pinned: frontmatter.pinned === true,
        };
      }),
    );

    return headerResults
      .filter(
        (r): r is PromiseFulfilledResult<MemoryHeader> =>
          r.status === 'fulfilled',
      )
      .map(r => r.value)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_MEMORY_FILES);
  } catch {
    return [];
  }
}

/**
 * Format memory headers as a text manifest: one line per file with
 * [type] filename (timestamp): description.
 */
export function formatMemoryManifest(memories: MemoryHeader[]): string {
  return memories
    .map(m => {
      const tag = m.type ? `[${m.type}] ` : '';
      const ts = new Date(m.mtimeMs).toISOString();
      return m.description
        ? `- ${tag}${m.filename} (${ts}): ${m.description}`
        : `- ${tag}${m.filename} (${ts})`;
    })
    .join('\n');
}
