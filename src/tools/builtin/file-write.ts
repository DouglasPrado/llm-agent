import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { AgentTool } from '../../contracts/entities/agent-tool.js';
import { assertSafePath } from './path-guard.js';

const FileWriteParams = z.object({
  file_path: z.string().describe('Absolute path to the file to write'),
  content: z.string().describe('Content to write to the file'),
});

export function createFileWriteTool(workingDir?: string): AgentTool {
  return {
    name: 'Write',
    description: 'Write content to a file. Creates parent directories if needed. Overwrites existing files.',
    parameters: FileWriteParams,
    isDestructive: true,
    getFilePath: (args) => (args as { file_path: string }).file_path,

    async execute(rawArgs: unknown) {
      const { file_path, content } = rawArgs as z.infer<typeof FileWriteParams>;

      if (workingDir) {
        try {
          assertSafePath(file_path, workingDir);
        } catch (error) {
          return { content: (error as Error).message, isError: true };
        }
      }

      try {
        await mkdir(dirname(file_path), { recursive: true });
        await writeFile(file_path, content, 'utf-8');
        const bytes = Buffer.byteLength(content, 'utf-8');
        return `Successfully wrote ${bytes} bytes to ${file_path}`;
      } catch (error) {
        return { content: `Cannot write file: ${file_path} — ${(error as Error).message}`, isError: true };
      }
    },
  };
}
