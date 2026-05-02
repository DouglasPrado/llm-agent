import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AgentTool } from '../../contracts/entities/agent-tool.js';
import { matchGlob } from '../../skills/skill-glob.js';

const DEFAULT_MAX_RESULTS = 50;

const GrepParams = z.object({
  pattern: z.string().describe('Regex pattern to search for'),
  path: z.string().optional().describe('Directory to search in. Defaults to cwd.'),
  glob: z.string().optional().describe('Glob pattern to filter files (e.g. "*.ts")'),
  max_results: z.number().optional().describe('Max matching lines to return. Default: 50.'),
});

async function collectFiles(dir: string, globPattern?: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        if (globPattern) {
          const relative = full.slice(dir.length + 1);
          if (!matchGlob(globPattern, relative) && !matchGlob(globPattern, entry.name)) continue;
        }
        results.push(full);
      }
    }
  }
  await walk(dir);
  return results;
}

export function createGrepTool(): AgentTool {
  return {
    name: 'Grep',
    description: 'Search file contents using regex. Returns matching lines with file paths and line numbers.',
    parameters: GrepParams,
    isConcurrencySafe: true,
    isReadOnly: true,

    async execute(rawArgs: unknown, signal: AbortSignal) {
      const { pattern, path: searchPath, glob: globFilter, max_results } = rawArgs as z.infer<typeof GrepParams>;
      const baseDir = searchPath || process.cwd();
      const maxResults = max_results ?? DEFAULT_MAX_RESULTS;

      // Reject patterns that can cause catastrophic backtracking (ReDoS).
      // Catches: quantified groups (a+)+, consecutive quantifiers a+*, quantified classes [a-z]*,
      // and alternation groups with external quantifier (a|ab)*.
      const REDOS_RISK = /(\(.*[+*?]\)|[+*?]{2,}|\[\^?.*\]\*|\([^)]*\|[^)]*\)[+*?{])/;
      if (REDOS_RISK.test(pattern)) {
        return { content: 'Pattern too complex — potential ReDoS risk', isError: true };
      }

      let regex: RegExp;
      try {
        regex = new RegExp(pattern, 'g');
      } catch (e) {
        return { content: `Invalid regex: ${String(e)}`, isError: true };
      }

      // ReDoS defense: cap per-line length so pathological patterns
      // (e.g. `(a+)+b` on long runs) can't hang the tool. Matching lines
      // longer than this is rare in practice for source-code grep.
      const MAX_LINE_LENGTH = 10_000;

      const files = await collectFiles(baseDir, globFilter);
      const matches: string[] = [];

      for (const file of files) {
        if (matches.length >= maxResults) break;
        if (signal.aborted) break;

        try {
          const s = await stat(file);
          if (s.size > 1_000_000) continue; // skip files > 1MB

          const content = await readFile(file, 'utf-8');
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxResults) break;
            const line = lines[i]!;
            if (line.length > MAX_LINE_LENGTH) continue;
            regex.lastIndex = 0;
            if (regex.test(line)) {
              const relative = file.slice(baseDir.length + 1) || file;
              matches.push(`${relative}:${i + 1}:${line}`);
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      if (matches.length === 0) {
        return `No matches found for "${pattern}" in ${baseDir}`;
      }

      return matches.join('\n');
    },
  };
}
