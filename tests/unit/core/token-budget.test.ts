import { describe, it, expect, vi } from 'vitest';
import { executeReactLoop } from '../../../src/core/react-loop.js';
import { ToolExecutor } from '../../../src/tools/tool-executor.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';
import type { StreamChunk } from '../../../src/llm/message-types.js';
import type { AgentEvent } from '../../../src/contracts/entities/agent-event.js';
import type { Terminal } from '../../../src/core/loop-types.js';

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

describe('Token Budget Continuation', () => {
  it('should inject continue message when model stops below budget threshold', async () => {
    let callCount = 0;
    const client = {
      streamChat: vi.fn(async function* () {
        callCount++;
        if (callCount === 1) {
          yield { type: 'content', data: 'Partial work...' } as StreamChunk;
          yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 50, outputTokens: 100, totalTokens: 150 } } as StreamChunk;
        } else {
          yield { type: 'content', data: ' Completed!' } as StreamChunk;
          yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 60, outputTokens: 800, totalTokens: 860 } } as StreamChunk;
        }
      }),
    } as unknown as LLMClient;

    const executor = new ToolExecutor();
    const gen = executeReactLoop(
      [{ role: 'user', content: 'Write a long essay' }],
      {
        client, toolExecutor: executor, model: 'test',
        maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
        tokenBudget: { total: 2000, outputThreshold: 0.5 },
      },
    );

    const { events, terminal } = await consumeLoop(gen);

    expect(terminal.reason).toBe('stop');
    // Model was called multiple times (first below threshold, eventually above)
    expect(callCount).toBeGreaterThanOrEqual(2);

    // Should have recovery event for budget continuation
    const recoveryEvents = events.filter(e => e.type === 'recovery' && (e as { reason: string }).reason === 'token_budget_continuation');
    expect(recoveryEvents.length).toBeGreaterThan(0);
  });

  it('should not continue when output tokens exceed threshold', async () => {
    const client = {
      streamChat: vi.fn(async function* () {
        yield { type: 'content', data: 'Complete response' } as StreamChunk;
        yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 50, outputTokens: 800, totalTokens: 850 } } as StreamChunk;
      }),
    } as unknown as LLMClient;

    const executor = new ToolExecutor();
    const gen = executeReactLoop(
      [{ role: 'user', content: 'test' }],
      {
        client, toolExecutor: executor, model: 'test',
        maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
        tokenBudget: { total: 1000, outputThreshold: 0.5 },
      },
    );

    const { terminal } = await consumeLoop(gen);
    expect(terminal.reason).toBe('stop');
    // Only called once — output was above threshold
    expect(client.streamChat).toHaveBeenCalledOnce();
  });

  it('should stop after diminishing returns (3+ continuations with low delta)', async () => {
    let callCount = 0;
    const client = {
      streamChat: vi.fn(async function* () {
        callCount++;
        yield { type: 'content', data: `Attempt ${callCount}.` } as StreamChunk;
        // Always low output — triggers continuation but eventually gives up
        yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } } as StreamChunk;
      }),
    } as unknown as LLMClient;

    const executor = new ToolExecutor();
    const gen = executeReactLoop(
      [{ role: 'user', content: 'Write' }],
      {
        client, toolExecutor: executor, model: 'test',
        maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
        tokenBudget: { total: 2000, outputThreshold: 0.5 },
      },
    );

    const { terminal } = await consumeLoop(gen);

    expect(terminal.reason).toBe('stop');
    // Should have stopped after a few tries due to diminishing returns
    expect(callCount).toBeLessThanOrEqual(5);
  });

  it('should not trigger budget continuation when no tokenBudget configured', async () => {
    const client = {
      streamChat: vi.fn(async function* () {
        yield { type: 'content', data: 'Short' } as StreamChunk;
        yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } } as StreamChunk;
      }),
    } as unknown as LLMClient;

    const executor = new ToolExecutor();
    const gen = executeReactLoop(
      [{ role: 'user', content: 'test' }],
      {
        client, toolExecutor: executor, model: 'test',
        maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
        // No tokenBudget
      },
    );

    const { terminal } = await consumeLoop(gen);
    expect(terminal.reason).toBe('stop');
    expect(client.streamChat).toHaveBeenCalledOnce();
  });
});
