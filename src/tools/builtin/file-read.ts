import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { AgentTool } from '../../contracts/entities/agent-tool.js';
import { assertSafePath } from './path-guard.js';

const MAX_FILE_SIZE = 1_000_000; // 1MB
const DEFAULT_LIMIT = 2000;

const FileReadParams = z.object({
  file_path: z.string().describe('Absolute path to the file to read'),
  offset: z.number().optional().describe('Line number to start reading from (1-based)'),
  limit: z.number().optional().describe('Number of lines to read. Default: 2000'),
});

export function createFileReadTool(workingDir?: string): AgentTool {
  return {
    name: 'Read',
    description: 'Read file contents with line numbers. Supports partial reads with offset and limit.',
    parameters: FileReadParams,
    isConcurrencySafe: true,
    isReadOnly: true,
    getFilePath: (args) => (args as { file_path: string }).file_path,

    async execute(rawArgs: unknown) {
      const { file_path, offset, limit } = rawArgs as z.infer<typeof FileReadParams>;

      if (workingDir) {
        try {
          assertSafePath(file_path, workingDir);
        } catch (error) {
          return { content: (error as Error).message, isError: true };
        }
      }

      try {
        const fileStat = await stat(file_path);
        if (fileStat.size > MAX_FILE_SIZE) {
          return { content: `File too large (${fileStat.size} bytes). Use offset/limit to read portions.`, isError: true };
        }

        const content = await readFile(file_path, 'utf-8');
        const allLines = content.split('\n');

        const startLine = Math.max(1, offset ?? 1);
        const lineLimit = limit ?? DEFAULT_LIMIT;
        const endLine = Math.min(allLines.length, startLine + lineLimit - 1);

        const numbered = allLines
          .slice(startLine - 1, endLine)
          .map((line, i) => `${String(startLine + i).padStart(6)}\t${line}`)
          .join('\n');

        const total = allLines.length;
        const showing = endLine - startLine + 1;
        const header = showing < total
          ? `Showing lines ${startLine}-${endLine} of ${total}:\n`
          : '';

        return `${header}${numbered}`;
      } catch (error) {
        return { content: `Cannot read file: ${file_path} — ${(error as Error).message}`, isError: true };
      }
    },
  };
}
