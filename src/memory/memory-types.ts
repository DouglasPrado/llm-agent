/**
 * Memory type taxonomy — file-based memory system.
 *
 * Memories are constrained to four types capturing context NOT derivable
 * from the current project state. Code patterns, architecture, git history,
 * and file structure are derivable (via grep/git) and should NOT be saved.
 */

export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

/**
 * Parse a raw frontmatter value into a MemoryType.
 * Invalid or missing values return undefined — legacy files without a
 * `type:` field keep working, files with unknown types degrade gracefully.
 */
export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== 'string') return undefined;
  return MEMORY_TYPES.find(t => t === raw);
}

/** Header from scanning a memory file (frontmatter only, no body) */
export interface MemoryHeader {
  filename: string;
  filePath: string;
  mtimeMs: number;
  name: string | null;
  description: string | null;
  type: MemoryType | undefined;
  pinned: boolean;
}

/** Full memory file including body content */
export interface MemoryFile extends MemoryHeader {
  content: string;
}

/** Frontmatter fields for a memory file */
export interface MemoryFrontmatter {
  name?: string;
  description?: string;
  type?: string;
  pinned?: boolean;
}

/** Input for saving a new memory */
export interface SaveMemoryInput {
  name: string;
  description: string;
  type: MemoryType;
  content: string;
}

/** Constants */
export const ENTRYPOINT_NAME = 'MEMORY.md';
export const MAX_MEMORY_FILES = 200;
export const MAX_ENTRYPOINT_LINES = 200;
export const MAX_ENTRYPOINT_BYTES = 25_000;
