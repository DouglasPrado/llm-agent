import { describe, it, expect, vi } from 'vitest';
import { executeReactLoop } from '../../../src/core/react-loop.js';
import { ToolExecutor } from '../../../src/tools/tool-executor.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';
import type { StreamChunk } from '../../../src/llm/message-types.js';
import type { AgentEvent } from '../../../src/contracts/entities/agent-event.js';
import type { Terminal } from '../../../src/core/loop-types.js';
import type { StopHook } from '../../../src/core/stop-hooks.js';

async function consumeLoop(
  gen: AsyncGenerator<AgentEvent, Terminal>,
): Promise<{ events: AgentEvent[]; terminal: Terminal }> {
  const events: AgentEvent[] = [];
  let result = await gen.next();
  while (!result.done) {
    events.push(result.value);
    result = await gen.next();
  }
  return { events, terminal: result.value };
}

function createMockClient(chunks: StreamChunk[][]): LLMClient {
  let call = 0;
  return {
    streamChat: vi.fn(async function* () {
      const iteration = chunks[call] ?? chunks[chunks.length - 1]!;
      call++;
      yield* iteration;
    }),
  } as unknown as LLMClient;
}

describe('Stop Hooks', () => {
  it('should run stop hooks when model produces final text (no tool calls)', async () => {
    const hookExecute = vi.fn().mockResolvedValue({ blockingErrors: [], preventContinuation: false });
    const hook: StopHook = { name: 'test-hook', execute: hookExecute };

    const client = createMockClient([[
      { type: 'content', data: 'Done!' },
      { type: 'done', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
    ]]);

    const executor = new ToolExecutor();
    const gen = executeReactLoop(
      [{ role: 'user', content: 'test' }],
      {
        client, toolExecutor: executor, model: 'test',
        maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
        stopHooks: [hook],
      },
    );

    const { terminal } = await consumeLoop(gen);
    expect(terminal.reason).toBe('stop');
    expect(hookExecute).toHaveBeenCalledOnce();
  });

  it('should prevent continuation when hook says so', async () => {
    const hook: StopHook = {
      name: 'prevent-hook',
      execute: vi.fn().mockResolvedValue({ blockingErrors: [], preventContinuation: true }),
    };

    const client = createMockClient([[
      { type: 'content', data: 'text' },
      { type: 'done', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
    ]]);

    const executor = new ToolExecutor();
    const gen = executeReactLoop(
      [{ role: 'user', content: 'test' }],
      {
        client, toolExecutor: executor, model: 'test',
        maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
        stopHooks: [hook],
      },
    );

    const { terminal } = await consumeLoop(gen);
    expect(terminal.reason).toBe('stop_hook');
  });

  it('should inject blocking errors and continue the loop', async () => {
    const hook: StopHook = {
      name: 'blocking-hook',
      execute: vi.fn()
        .mockResolvedValueOnce({ blockingErrors: ['Validation failed: missing field X'], preventContinuation: false })
        .mockResolvedValueOnce({ blockingErrors: [], preventContinuation: false }),
    };

    const client = createMockClient([
      // First: model responds
      [
        { type: 'content', data: 'First attempt' },
        { type: 'done', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
      ],
      // Second: model responds after receiving blocking error
      [
        { type: 'content', data: 'Fixed!' },
        { type: 'done', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ],
    ]);

    const executor = new ToolExecutor();
    const gen = executeReactLoop(
      [{ role: 'user', content: 'test' }],
      {
        client, toolExecutor: executor, model: 'test',
        maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
        stopHooks: [hook],
      },
    );

    const { events, terminal } = await consumeLoop(gen);
    expect(terminal.reason).toBe('stop');

    // Hook should have been called twice
    expect(hook.execute).toHaveBeenCalledTimes(2);

    // Should have recovery event for stop hook
    const recoveryEvents = events.filter(e => e.type === 'recovery');
    expect(recoveryEvents.length).toBeGreaterThan(0);
  });

  it('should not run stop hooks when model makes tool calls', async () => {
    const hookExecute = vi.fn().mockResolvedValue({ blockingErrors: [], preventContinuation: false });
    const hook: StopHook = { name: 'test-hook', execute: hookExecute };

    const client = createMockClient([
      [
        { type: 'tool_call', id: 'c1', name: 'tool', arguments: '{}' },
        { type: 'done', finishReason: 'tool_calls', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
      ],
      [
        { type: 'content', data: 'Done after tool' },
        { type: 'done', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ],
    ]);

    const executor = new ToolExecutor();
    executor.register({
      name: 'tool',
      description: 'Tool',
      parameters: (await import('zod')).z.object({}),
      execute: vi.fn().mockResolvedValue('ok'),
    });

    const gen = executeReactLoop(
      [{ role: 'user', content: 'test' }],
      {
        client, toolExecutor: executor, model: 'test',
        maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
        stopHooks: [hook],
      },
    );

    const { terminal } = await consumeLoop(gen);
    expect(terminal.reason).toBe('stop');
    // Hook only called once (on the final text response, not on tool call iteration)
    expect(hookExecute).toHaveBeenCalledOnce();
  });
});
