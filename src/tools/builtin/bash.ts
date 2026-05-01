import { exec } from 'node:child_process';
import { z } from 'zod';
import type { AgentTool } from '../../contracts/entities/agent-tool.js';

/**
 * Attempt to kill an entire process group (POSIX only).
 * On POSIX, spawning with `detached: true` creates a new process group
 * whose PGID equals the child PID, so `process.kill(-pid)` terminates
 * the whole group (including grandchildren like backgrounded `sleep`).
 * On Windows, we fall back to a direct kill of the child.
 */
function killTree(pid: number | undefined, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      process.kill(pid, signal);
    } else {
      process.kill(-pid, signal);
    }
  } catch { /* already exited */ }
}

const DEFAULT_TIMEOUT = 120_000;
const MAX_OUTPUT = 500_000; // 500KB

const BashParams = z.object({
  command: z.string().describe('Shell command to execute'),
  timeout: z
    .number()
    .int()
    .min(1, 'Timeout must be at least 1ms')
    .max(300_000, 'Timeout cannot exceed 5 minutes (300000ms)')
    .optional()
    .describe('Timeout in milliseconds. Default: 120000 (2 minutes). Max: 300000 (5 minutes).'),
});

export interface BashToolOptions {
  /** Restrict the subprocess working directory. Commands run relative to this path. */
  workingDir?: string;
  /** If set, only commands whose first token matches a prefix in this list are allowed. */
  allowedCommands?: string[];
}

export function createBashTool(options: BashToolOptions = {}): AgentTool {
  const { workingDir, allowedCommands } = options;

  return {
    name: 'Bash',
    description: 'Execute a shell command and return stdout/stderr.',
    parameters: BashParams,
    isDestructive: true, // conservative — commands can have side effects
    timeoutMs: DEFAULT_TIMEOUT,

    async execute(rawArgs: unknown, signal: AbortSignal) {
      const { command, timeout } = BashParams.parse(rawArgs);

      if (allowedCommands && allowedCommands.length > 0) {
        // Reject shell metacharacters that allow command chaining/injection even when the
        // first token is in the allow-list (e.g. "ls; rm -rf /", "echo hi | cat").
        const DANGEROUS_METACHAR = /[;&|`$<>()\n\\]/;
        if (DANGEROUS_METACHAR.test(command)) {
          return {
            content: 'Command contains forbidden shell metacharacters',
            isError: true,
          };
        }
        const firstToken = command.trimStart().split(/\s+/)[0] ?? '';
        const allowed = allowedCommands.some(prefix => firstToken === prefix);
        if (!allowed) {
          return {
            content: `Command not allowed by allowedCommands policy. Allowed prefixes: ${allowedCommands.join(', ')}`,
            isError: true,
          };
        }
      }

      const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT;

      return new Promise<string | { content: string; isError?: boolean }>((resolve) => {
        const child = exec(command, {
          timeout: effectiveTimeout,
          maxBuffer: MAX_OUTPUT,
          shell: process.env.SHELL || '/bin/sh',
          ...(workingDir ? { cwd: workingDir } : {}),
          // Detach on POSIX so the child gets its own process group —
          // lets us kill the whole tree (including backgrounded grandchildren).
          ...(process.platform !== 'win32' ? { detached: true } : {}),
        }, (error, stdout, stderr) => {
          const out = stdout?.slice(0, MAX_OUTPUT) ?? '';
          const err = stderr?.slice(0, MAX_OUTPUT) ?? '';

          if (error) {
            const exitCode = error.code ?? 'unknown';
            const parts: string[] = [];
            if (out) parts.push(out);
            if (err) parts.push(err);
            if (!out && !err) parts.push(error.message);
            parts.push(`\nExit code: ${exitCode}`);

            resolve({ content: parts.join('\n'), isError: true });
            return;
          }

          const parts: string[] = [];
          if (out) parts.push(out);
          if (err) parts.push(`[stderr]\n${err}`);
          if (!out && !err) parts.push('(no output)');

          resolve(parts.join('\n'));
        });

        // Abort propagates to the entire process group so subshells and
        // backgrounded commands are not left orphaned.
        const onAbort = (): void => killTree(child.pid, 'SIGTERM');
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
        child.on('close', () => signal.removeEventListener('abort', onAbort));
      });
    },
  };
}
