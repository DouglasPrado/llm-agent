/**
 * File-based memory system — main orchestrator.
 *
 * Manages Markdown memory files with YAML frontmatter and a MEMORY.md index.
 * Supports thread-isolated memory: each threadId gets its own subdirectory.
 * Global memories (no threadId) live in the root memoryDir.
 *
 * Layout:
 *   memoryDir/
 *     MEMORY.md           ← global index
 *     project-info.md     ← global memory
 *     threads/
 *       telegram-123/
 *         MEMORY.md       ← thread index
 *         user-name.md    ← thread-scoped memory
 *       teams-456/
 *         MEMORY.md
 *         ...
 */

import { readFile, writeFile, unlink, stat, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { LLMClient } from '../llm/llm-client.js';
import type { Logger } from '../utils/logger.js';
import type { MemoryFile, MemoryHeader, SaveMemoryInput } from './memory-types.js';
import {
  ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_LINES,
  MAX_ENTRYPOINT_BYTES,
  parseMemoryType,
} from './memory-types.js';
import { resolveMemoryDir, ensureMemoryDir, sanitizeFilename, sanitizeFrontmatterValue, validateThreadId } from './memory-paths.js';
import { scanMemoryFiles, formatMemoryManifest, parseFrontmatter } from './memory-scanner.js';
import { selectRelevantMemories } from './memory-relevance.js';
import { memoryFreshnessNote } from './memory-age.js';
import { buildMemoryInstructions } from './memory-prompts.js';

export interface FileMemoryConfig {
  enabled?: boolean;
  memoryDir?: string;
  relevanceModel?: string;
  maxMemoryFiles?: number;
  extractionEnabled?: boolean;
}

const THREADS_DIR = 'threads';

export class FileMemorySystem {
  private readonly memoryDir: string;
  private readonly client: LLMClient;
  private readonly logger: Logger;
  private readonly relevanceModel?: string;
  private lockChain: Promise<void> = Promise.resolve();

  constructor(config: FileMemoryConfig, client: LLMClient, logger: Logger) {
    this.memoryDir = resolveMemoryDir(config.memoryDir);
    this.client = client;
    this.logger = logger;
    this.relevanceModel = config.relevanceModel;
  }

  /** Ensure the memory directory exists (idempotent). */
  async ensureDir(): Promise<void> {
    await ensureMemoryDir(this.memoryDir);
  }

  /** Get the resolved memory directory path. */
  getMemoryDir(): string {
    return this.memoryDir;
  }

  /**
   * Resolve the effective directory for a threadId.
   * No threadId → root memoryDir (global).
   * With threadId → memoryDir/threads/{threadId}/
   */
  private resolveDir(threadId?: string): string {
    if (!threadId) return this.memoryDir;
    const safeId = validateThreadId(threadId);
    if (!safeId) throw new Error(`Invalid threadId: ${JSON.stringify(threadId)}`);
    return join(this.memoryDir, THREADS_DIR, safeId);
  }

  /** Ensure a thread directory exists. */
  private async ensureThreadDir(threadId?: string): Promise<void> {
    const dir = this.resolveDir(threadId);
    await mkdir(dir, { recursive: true });
  }

  /**
   * Save a new memory file and update the MEMORY.md index.
   * When threadId is provided, saves to the thread subdirectory.
   */
  async saveMemory(input: SaveMemoryInput, threadId?: string): Promise<string> {
    await this.ensureThreadDir(threadId);

    const dir = this.resolveDir(threadId);
    const filename = sanitizeFilename(input.name);
    const filePath = join(dir, filename);

    const fileContent = [
      '---',
      `name: ${sanitizeFrontmatterValue(input.name)}`,
      `description: ${sanitizeFrontmatterValue(input.description)}`,
      `type: ${input.type}`,
      '---',
      '',
      input.content,
      '',
    ].join('\n');

    await writeFile(filePath, fileContent, 'utf-8');
    await this.addToIndex(filename, input.description, threadId);

    this.logger.debug('Memory saved', { filename, type: input.type, threadId: threadId ?? 'global' });
    return filename;
  }

  /**
   * Read and parse a memory file.
   * When threadId is provided, reads from thread subdirectory.
   */
  async readMemory(filename: string, threadId?: string): Promise<MemoryFile | null> {
    try {
      const dir = this.resolveDir(threadId);
      const filePath = join(dir, filename);
      const content = await readFile(filePath, 'utf-8');
      const fileStat = await stat(filePath);
      const frontmatter = parseFrontmatter(content);

      const bodyMatch = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)/);
      const body = bodyMatch?.[1]?.trim() ?? content;

      return {
        filename,
        filePath,
        mtimeMs: fileStat.mtimeMs,
        name: frontmatter.name ?? null,
        description: frontmatter.description ?? null,
        type: parseMemoryType(frontmatter.type),
        pinned: frontmatter.pinned === true,
        content: body,
      };
    } catch {
      return null;
    }
  }

  /**
   * Delete a memory file and remove its entry from the index.
   */
  async deleteMemory(filename: string, threadId?: string): Promise<boolean> {
    try {
      const dir = this.resolveDir(threadId);
      const filePath = join(dir, filename);
      await unlink(filePath);
      await this.removeFromIndex(filename, threadId);
      this.logger.debug('Memory deleted', { filename, threadId: threadId ?? 'global' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Scan memory files. When threadId is provided, scans thread dir + global dir (merged).
   */
  async scanMemories(signal?: AbortSignal, threadId?: string): Promise<MemoryHeader[]> {
    const globalMemories = await scanMemoryFiles(this.memoryDir, signal);

    if (!threadId) return globalMemories;

    const threadDir = this.resolveDir(threadId);
    const threadMemories = await scanMemoryFiles(threadDir, signal);

    // Merge: thread memories first (higher priority), then global
    // Dedupe by filename (thread wins)
    const seen = new Set(threadMemories.map(m => m.filename));
    const merged = [...threadMemories, ...globalMemories.filter(m => !seen.has(m.filename))];
    return merged;
  }

  /**
   * Find relevant memories for a query using LLM selection.
   * Scans thread + global memories when threadId is provided.
   */
  async findRelevant(
    query: string,
    signal?: AbortSignal,
    excludeFilenames?: ReadonlySet<string>,
    threadId?: string,
  ): Promise<MemoryFile[]> {
    const memories = await this.scanMemories(signal, threadId);
    if (memories.length === 0) return [];

    const filtered = excludeFilenames?.size
      ? memories.filter(m => !excludeFilenames.has(m.filename))
      : memories;
    if (filtered.length === 0) return [];

    const manifest = formatMemoryManifest(filtered);
    const validFilenames = new Set(filtered.map(m => m.filename));

    const selectedFilenames = await selectRelevantMemories(
      query,
      manifest,
      validFilenames,
      this.client,
      { model: this.relevanceModel, signal, logger: this.logger },
    );

    const results: MemoryFile[] = [];
    for (const filename of selectedFilenames) {
      // Try thread dir first, then global
      const memory = threadId
        ? (await this.readMemory(filename, threadId) ?? await this.readMemory(filename))
        : await this.readMemory(filename);
      if (memory) results.push(memory);
    }

    return results;
  }

  /**
   * Build the context prompt from MEMORY.md.
   * When threadId is provided, merges global + thread MEMORY.md.
   */
  async buildContextPrompt(threadId?: string): Promise<string> {
    const parts: string[] = [];

    // Global MEMORY.md
    try {
      const globalContent = await readFile(join(this.memoryDir, ENTRYPOINT_NAME), 'utf-8');
      if (globalContent.trim()) parts.push(globalContent.trim());
    } catch { /* no global index */ }

    // Thread MEMORY.md
    if (threadId) {
      try {
        const threadContent = await readFile(join(this.resolveDir(threadId), ENTRYPOINT_NAME), 'utf-8');
        if (threadContent.trim()) parts.push(threadContent.trim());
      } catch { /* no thread index */ }
    }

    if (parts.length === 0) return '';
    return truncateEntrypointContent(parts.join('\n'));
  }

  /**
   * Build the behavioral instructions prompt for the memory system.
   */
  getMemoryInstructions(): string {
    return buildMemoryInstructions(this.memoryDir);
  }

  /**
   * Build the full memory context for injection (MEMORY.md + pinned + relevant memories).
   *
   * Pinned memories (frontmatter `pinned: true`) are always injected, bypassing
   * the LLM relevance selector. They are excluded from the relevance pool to
   * avoid duplication.
   */
  async buildFullContext(query: string, signal?: AbortSignal, threadId?: string): Promise<string> {
    const parts: string[] = [];

    const indexContent = await this.buildContextPrompt(threadId);
    if (indexContent) {
      parts.push('# Memory Index\n' + indexContent);
    }

    const allMemories = await this.scanMemories(signal, threadId);
    const pinnedHeaders = allMemories.filter(m => m.pinned);
    const pinnedFilenames = new Set(pinnedHeaders.map(m => m.filename));

    const pinnedFiles: MemoryFile[] = [];
    for (const header of pinnedHeaders) {
      // Pinned memories can live in either thread or global dir. Try thread first
      // when threadId is set (mirrors findRelevant's lookup order).
      const mem = threadId
        ? (await this.readMemory(header.filename, threadId) ?? await this.readMemory(header.filename))
        : await this.readMemory(header.filename);
      if (mem) pinnedFiles.push(mem);
    }

    if (pinnedFiles.length > 0) {
      parts.push('# Pinned Memories');
      for (const mem of pinnedFiles) {
        const freshness = memoryFreshnessNote(mem.mtimeMs);
        const header = mem.name ? `## ${mem.name}` : `## ${mem.filename}`;
        parts.push(`${header}\n${freshness}${mem.content}`);
      }
    }

    const relevant = await this.findRelevant(query, signal, pinnedFilenames, threadId);
    if (relevant.length > 0) {
      parts.push('# Relevant Memories');
      for (const mem of relevant) {
        const freshness = memoryFreshnessNote(mem.mtimeMs);
        const header = mem.name ? `## ${mem.name}` : `## ${mem.filename}`;
        parts.push(`${header}\n${freshness}${mem.content}`);
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Check if any memory files were created or modified since the given timestamp.
   * When threadId is provided, checks only the thread directory.
   */
  async hasWritesSince(sinceMs: number, threadId?: string): Promise<boolean> {
    const dir = this.resolveDir(threadId);
    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (!entry.endsWith('.md') || entry === ENTRYPOINT_NAME) continue;
        const fileStat = await stat(join(dir, entry));
        if (fileStat.mtimeMs > sinceMs) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // --- Private helpers ---

  private async addToIndex(filename: string, description: string, threadId?: string): Promise<void> {
    await this.withWriteLock(async () => {
      const dir = this.resolveDir(threadId);
      const entrypoint = join(dir, ENTRYPOINT_NAME);
      let existing = '';
      try {
        existing = await readFile(entrypoint, 'utf-8');
      } catch { /* File doesn't exist yet */ }

      if (existing.includes(`(${filename})`)) return;

      const safeDescription = sanitizeFrontmatterValue(description);
      const newEntry = `- [${safeDescription}](${filename}) — ${safeDescription}`;
      const updated = existing ? `${existing.trimEnd()}\n${newEntry}\n` : `${newEntry}\n`;
      await writeFile(entrypoint, updated, 'utf-8');
    });
  }

  private async removeFromIndex(filename: string, threadId?: string): Promise<void> {
    await this.withWriteLock(async () => {
      const dir = this.resolveDir(threadId);
      const entrypoint = join(dir, ENTRYPOINT_NAME);
      try {
        const content = await readFile(entrypoint, 'utf-8');
        const lines = content.split('\n').filter(line => !line.includes(`(${filename})`));
        await writeFile(entrypoint, lines.join('\n'), 'utf-8');
      } catch { /* Index doesn't exist */ }
    });
  }

  private withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.lockChain.then(() => fn());
    this.lockChain = result.then(() => {}, () => {});
    return result;
  }
}

/**
 * Truncate MEMORY.md content to limits: 200 lines, 25KB.
 */
export function truncateEntrypointContent(content: string): string {
  const lines = content.split('\n');

  if (lines.length > MAX_ENTRYPOINT_LINES) {
    const truncated = lines.slice(0, MAX_ENTRYPOINT_LINES).join('\n');
    return truncated + `\n\n[... truncated: ${lines.length - MAX_ENTRYPOINT_LINES} more lines]`;
  }

  const bytes = new TextEncoder().encode(content).length;
  if (bytes > MAX_ENTRYPOINT_BYTES) {
    let cutoff = content.length;
    while (new TextEncoder().encode(content.slice(0, cutoff)).length > MAX_ENTRYPOINT_BYTES) {
      const lastNewline = content.lastIndexOf('\n', cutoff - 1);
      if (lastNewline <= 0) break;
      cutoff = lastNewline;
    }
    return content.slice(0, cutoff) + '\n\n[... truncated: exceeded 25KB limit]';
  }

  return content;
}
