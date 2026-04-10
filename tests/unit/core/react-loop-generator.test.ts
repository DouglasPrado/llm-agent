import { describe, it, expect, vi } from 'vitest';
import { executeReactLoop } from '../../../src/core/react-loop.js';
import { ToolExecutor } from '../../../src/tools/tool-executor.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';
import type { StreamChunk } from '../../../src/llm/message-types.js';
import type { AgentEvent } from '../../../src/contracts/entities/agent-event.js';
import type { Terminal } from '../../../src/core/loop-types.js';
import { z } from 'zod';

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

/** Consume the generator, collect events and terminal */
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

describe('executeReactLoop (AsyncGenerator)', () => {
  it('should yield text_delta events and return Terminal on text response', async () => {
    const client = createMockClient([[
      { type: 'content', data: 'Hello' },
      { type: 'content', data: ' world!' },
      { type: 'done', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
    ]]);

    const executor = new ToolExecutor();
    const gen = executeReactLoop(
      [{ role: 'user', content: 'Hi' }],
      { client, toolExecutor: executor, model: 'test', maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue' },
    );

    const { events, terminal } = await consumeLoop(gen);

    expect(terminal.reason).toBe('stop');
    expect(terminal.usage.totalTokens).toBe(7);

    const textDeltas = events.filter(e => e.type === 'text_delta');
    expect(textDeltas).toHaveLength(2);

    const textDone = events.find(e => e.type === 'text_done');
    expect(textDone).toBeDefined();
  });

  it('should yield tool events and loop on tool calls', async () => {
    const client = createMockClient([
      [
        { type: 'tool_call', id: 'call_1', name: 'get_weather', arguments: '{"city":"NYC"}' },
        { type: 'done', finishReason: 'tool_calls', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ],
      [
        { type: 'content', data: 'The weather in NYC is sunny.' },
        { type: 'done', finishReason: 'stop', usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } },
      ],
    ]);

    const executor = new ToolExecutor();
    executor.register({
      name: 'get_weather',
      description: 'Get weather',
      parameters: z.object({ city: z.string() }),
      execute: vi.fn().mockResolvedValue('Sunny, 25C'),
      isConcurrencySafe: true,
    });

    const gen = executeReactLoop(
      [{ role: 'user', content: 'Weather in NYC?' }],
      { client, toolExecutor: executor, model: 'test', maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue' },
    );

    const { events, terminal } = await consumeLoop(gen);

    expect(terminal.reason).toBe('stop');
    expect(terminal.usage.totalTokens).toBe(45);

    const toolStarts = events.filter(e => e.type === 'tool_call_start');
    expect(toolStarts).toHaveLength(1);

    const toolEnds = events.filter(e => e.type === 'tool_call_end');
    expect(toolEnds).toHaveLength(1);
  });

  it('should return max_iterations terminal when limit reached', async () => {
    const client = createMockClient([
      [
        { type: 'tool_call', id: 'call_1', name: 'loop_tool', arguments: '{}' },
        { type: 'done', finishReason: 'tool_calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ],
    ]);

    const executor = new ToolExecutor();
    executor.register({
      name: 'loop_tool',
      description: 'Loops',
      parameters: z.object({}),
      execute: vi.fn().mockResolvedValue('ok'),
    });

    const gen = executeReactLoop(
      [{ role: 'user', content: 'loop' }],
      { client, toolExecutor: executor, model: 'test', maxIterations: 2, maxConsecutiveErrors: 3, onToolError: 'continue' },
    );

    const { events, terminal } = await consumeLoop(gen);

    expect(terminal.reason).toBe('max_iterations');
    const warnings = events.filter(e => e.type === 'warning');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('should return cost_limit terminal when budget exceeded', async () => {
    const client = createMockClient([
      [
        { type: 'tool_call', id: 'c1', name: 'tool', arguments: '{}' },
        { type: 'done', finishReason: 'tool_calls', usage: { inputTokens: 300, outputTokens: 300, totalTokens: 600 } },
      ],
      [
        { type: 'content', data: 'text' },
        { type: 'done', finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 } },
      ],
    ]);

    const executor = new ToolExecutor();
    executor.register({
      name: 'tool',
      description: 'Tool',
      parameters: z.object({}),
      execute: vi.fn().mockResolvedValue('ok'),
    });

    const gen = executeReactLoop(
      [{ role: 'user', content: 'test' }],
      {
        client, toolExecutor: executor, model: 'test',
        maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
        costPolicy: { maxTokensPerExecution: 500, onLimitReached: 'stop' },
      },
    );

    const { terminal } = await consumeLoop(gen);
    expect(terminal.reason).toBe('cost_limit');
  });

  it('should use immutable state — messages array should not be mutated', async () => {
    const client = createMockClient([
      [
        { type: 'tool_call', id: 'c1', name: 'tool', arguments: '{}' },
        { type: 'done', finishReason: 'tool_calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ],
      [
        { type: 'content', data: 'done' },
        { type: 'done', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ],
    ]);

    const executor = new ToolExecutor();
    executor.register({
      name: 'tool',
      description: 'Tool',
      parameters: z.object({}),
      execute: vi.fn().mockResolvedValue('ok'),
    });

    const originalMessages = [{ role: 'user' as const, content: 'test' }];
    const messagesCopy = [...originalMessages];

    const gen = executeReactLoop(originalMessages, {
      client, toolExecutor: executor, model: 'test',
      maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
    });

    await consumeLoop(gen);

    // Original messages array should NOT have been mutated
    expect(originalMessages).toEqual(messagesCopy);
  });

  it('should handle consecutive errors and return error terminal', async () => {
    let callCount = 0;
    const client = {
      streamChat: vi.fn(async function* () {
        callCount++;
        throw new Error(`API error ${callCount}`);
      }),
    } as unknown as LLMClient;

    const executor = new ToolExecutor();
    const gen = executeReactLoop(
      [{ role: 'user', content: 'test' }],
      { client, toolExecutor: executor, model: 'test', maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue' },
    );

    const { events, terminal } = await consumeLoop(gen);

    expect(terminal.reason).toBe('error');

    const errors = events.filter(e => e.type === 'error');
    expect(errors).toHaveLength(3);
  });

  it('should handle abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const client = createMockClient([[
      { type: 'content', data: 'text' },
      { type: 'done', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    ]]);

    const executor = new ToolExecutor();
    const gen = executeReactLoop(
      [{ role: 'user', content: 'test' }],
      { client, toolExecutor: executor, model: 'test', maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue', signal: controller.signal },
    );

    const { terminal } = await consumeLoop(gen);
    expect(terminal.reason).toBe('abort');
  });

  it('should yield turn_start and turn_end events for each iteration', async () => {
    const client = createMockClient([
      [
        { type: 'tool_call', id: 'c1', name: 'tool', arguments: '{}' },
        { type: 'done', finishReason: 'tool_calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ],
      [
        { type: 'content', data: 'done' },
        { type: 'done', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ],
    ]);

    const executor = new ToolExecutor();
    executor.register({
      name: 'tool',
      description: 'Tool',
      parameters: z.object({}),
      execute: vi.fn().mockResolvedValue('ok'),
    });

    const gen = executeReactLoop(
      [{ role: 'user', content: 'test' }],
      { client, toolExecutor: executor, model: 'test', maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue' },
    );

    const { events } = await consumeLoop(gen);

    const turnStarts = events.filter(e => e.type === 'turn_start');
    const turnEnds = events.filter(e => e.type === 'turn_end');

    // 2 iterations = 2 turn_starts + 2 turn_ends
    expect(turnStarts).toHaveLength(2);
    expect(turnEnds).toHaveLength(2);
  });

  it('should stop on tool error with onToolError=stop', async () => {
    const client = createMockClient([[
      { type: 'tool_call', id: 'c1', name: 'bad_tool', arguments: '{}' },
      { type: 'done', finishReason: 'tool_calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    ]]);

    const executor = new ToolExecutor();
    executor.register({
      name: 'bad_tool',
      description: 'Fails',
      parameters: z.object({}),
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    });

    const gen = executeReactLoop(
      [{ role: 'user', content: 'test' }],
      { client, toolExecutor: executor, model: 'test', maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'stop' },
    );

    const { terminal } = await consumeLoop(gen);
    expect(terminal.reason).toBe('error');
  });
});
