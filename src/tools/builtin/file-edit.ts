import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { AgentTool } from '../../contracts/entities/agent-tool.js';
import { assertSafePath } from './path-guard.js';

const FileEditParams = z.object({
  file_path: z.string().describe('Absolute path to the file to edit'),
  old_string: z.string().describe('Exact string to find and replace'),
  new_string: z.string().describe('Replacement string'),
  replace_all: z.boolean().optional().describe('Replace all occurrences. Default: false (must be unique).'),
});

export function createFileEditTool(workingDir?: string): AgentTool {
  return {
    name: 'Edit',
    description: 'Find and replace exact strings in a file. By default, old_string must be unique in the file.',
    parameters: FileEditParams,
    getFilePath: (args) => (args as { file_path: string }).file_path,

    async execute(rawArgs: unknown) {
      const { file_path, old_string, new_string, replace_all } = rawArgs as z.infer<typeof FileEditParams>;

      if (workingDir) {
        try {
          assertSafePath(file_path, workingDir);
        } catch (error) {
          return { content: (error as Error).message, isError: true };
        }
      }

      let content: string;
      try {
        content = await readFile(file_path, 'utf-8');
      } catch (error) {
        return { content: `Cannot read file: ${file_path} — ${(error as Error).message}`, isError: true };
      }

      if (!content.includes(old_string)) {
        return { content: `old_string not found in ${file_path}. Make sure it matches exactly.`, isError: true };
      }

      if (!replace_all) {
        const count = content.split(old_string).length - 1;
        if (count > 1) {
          return {
            content: `old_string found ${count} multiple times in ${file_path}. Use replace_all: true or provide more context to make it unique.`,
            isError: true,
          };
        }
      }

      const updated = replace_all
        ? content.split(old_string).join(new_string)
        : content.replace(old_string, new_string);

      try {
        await writeFile(file_path, updated, 'utf-8');
      } catch (error) {
        return { content: `Cannot write file: ${file_path} — ${(error as Error).message}`, isError: true };
      }

      const replacements = replace_all ? content.split(old_string).length - 1 : 1;
      return `Successfully edited ${file_path} (${replacements} replacement${replacements > 1 ? 's' : ''})`;
    },
  };
}
