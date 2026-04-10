import { describe, it, expect, vi } from 'vitest';
import { executeReactLoop } from '../../../src/core/react-loop.js';
import { ToolExecutor } from '../../../src/tools/tool-executor.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';
import type { StreamChunk } from '../../../src/llm/message-types.js';
import type { AgentEvent } from '../../../src/contracts/entities/agent-event.js';
import type { Terminal } from '../../../src/core/loop-types.js';
import type { LoopDeps } from '../../../src/core/loop-deps.js';

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

describe('LoopDeps (Dependency Injection)', () => {
  it('should use injected callModel instead of client.streamChat', async () => {
    const fakeCallModel = vi.fn(async function* () {
      yield { type: 'content', data: 'Injected response' } as StreamChunk;
      yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as StreamChunk;
    });

    // Client should NOT be called
    const client = {
      streamChat: vi.fn(async function* () {
        throw new Error('Should not be called');
      }),
    } as unknown as LLMClient;

    const executor = new ToolExecutor();
    const deps: Partial<LoopDeps> = { callModel: fakeCallModel };

    const gen = executeReactLoop(
      [{ role: 'user', content: 'test' }],
      {
        client, toolExecutor: executor, model: 'test',
        maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
        deps,
      },
    );

    const { events, terminal } = await consumeLoop(gen);

    expect(terminal.reason).toBe('stop');
    expect(fakeCallModel).toHaveBeenCalledOnce();
    expect(client.streamChat).not.toHaveBeenCalled();

    const textDeltas = events.filter(e => e.type === 'text_delta');
    expect(textDeltas).toHaveLength(1);
  });

  it('should use injected uuid for deterministic tracing', async () => {
    let uuidCounter = 0;
    const fakeUuid = () => `test-uuid-${++uuidCounter}`;

    const client = {
      streamChat: vi.fn(async function* () {
        yield { type: 'content', data: 'ok' } as StreamChunk;
        yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } } as StreamChunk;
      }),
    } as unknown as LLMClient;

    const executor = new ToolExecutor();
    const deps: Partial<LoopDeps> = { uuid: fakeUuid };

    const gen = executeReactLoop(
      [{ role: 'user', content: 'test' }],
      {
        client, toolExecutor: executor, model: 'test',
        maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
        deps,
      },
    );

    const { terminal } = await consumeLoop(gen);
    expect(terminal.reason).toBe('stop');
  });
});
