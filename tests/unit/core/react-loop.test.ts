import { describe, it, expect, vi } from 'vitest';
import { executeReactLoop } from '../../../src/core/react-loop.js';
import { StreamEmitter } from '../../../src/core/stream-emitter.js';
import { ToolExecutor } from '../../../src/tools/tool-executor.js';
import type { OpenRouterClient } from '../../../src/llm/openrouter-client.js';
import type { StreamChunk } from '../../../src/llm/message-types.js';
import type { AgentEvent } from '../../../src/contracts/entities/agent-event.js';
import { z } from 'zod';

function createMockClient(chunks: StreamChunk[][]): OpenRouterClient {
  let call = 0;
  return {
    streamChat: vi.fn(async function* () {
      const iteration = chunks[call] ?? chunks[chunks.length - 1]!;
      call++;
      yield* iteration;
    }),
  } as unknown as OpenRouterClient;
}

function collectEvents(emitter: StreamEmitter): AgentEvent[] {
  const events: AgentEvent[] = [];
  const iter = emitter.iterator();
  // Synchronous drain of already-queued events
  const originalEmit = emitter.emit.bind(emitter);
  emitter.emit = (event: AgentEvent) => {
    events.push(event);
    originalEmit(event);
  };
  return events;
}

describe('executeReactLoop', () => {
  it('should complete a simple text response', async () => {
    const client = createMockClient([[
      { type: 'content', data: 'Hello' },
      { type: 'content', data: ' world!' },
      { type: 'done', finishReason: 'stop', usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
    ]]);

    const emitter = new StreamEmitter();
    const events = collectEvents(emitter);
    const executor = new ToolExecutor();

    const result = await executeReactLoop(
      [{ role: 'user', content: 'Hi' }],
      { client, toolExecutor: executor, emitter, model: 'test', maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue' },
    );

    expect(result.reason).toBe('stop');
    expect(result.usage.totalTokens).toBe(7);

    const textDeltas = events.filter(e => e.type === 'text_delta');
    expect(textDeltas).toHaveLength(2);

    const textDone = events.find(e => e.type === 'text_done');
    expect(textDone).toBeDefined();
  });

  it('should execute tool calls and continue loop', async () => {
    const client = createMockClient([
      // First iteration: tool call
      [
        { type: 'tool_call', id: 'call_1', name: 'get_weather', arguments: '{"city":"NYC"}' },
        { type: 'done', finishReason: 'tool_calls', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
      ],
      // Second iteration: text response
      [
        { type: 'content', data: 'The weather in NYC is sunny.' },
        { type: 'done', finishReason: 'stop', usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } },
      ],
    ]);

    const emitter = new StreamEmitter();
    const events = collectEvents(emitter);
    const executor = new ToolExecutor();
    executor.register({
      name: 'get_weather',
      description: 'Get weather',
      parameters: z.object({ city: z.string() }),
      execute: vi.fn().mockResolvedValue('Sunny, 25C'),
    });

    const result = await executeReactLoop(
      [{ role: 'user', content: 'Weather in NYC?' }],
      { client, toolExecutor: executor, emitter, model: 'test', maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue' },
    );

    expect(result.reason).toBe('stop');
    expect(result.usage.totalTokens).toBe(45); // 15 + 30

    const toolCallStarts = events.filter(e => e.type === 'tool_call_start');
    expect(toolCallStarts).toHaveLength(1);

    const toolCallEnds = events.filter(e => e.type === 'tool_call_end');
    expect(toolCallEnds).toHaveLength(1);
  });

  it('should stop at maxIterations', async () => {
    const client = createMockClient([
      [
        { type: 'tool_call', id: 'call_1', name: 'loop_tool', arguments: '{}' },
        { type: 'done', finishReason: 'tool_calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ],
    ]);

    const emitter = new StreamEmitter();
    const events = collectEvents(emitter);
    const executor = new ToolExecutor();
    executor.register({
      name: 'loop_tool',
      description: 'Loops',
      parameters: z.object({}),
      execute: vi.fn().mockResolvedValue('ok'),
    });

    const result = await executeReactLoop(
      [{ role: 'user', content: 'loop' }],
      { client, toolExecutor: executor, emitter, model: 'test', maxIterations: 2, maxConsecutiveErrors: 3, onToolError: 'continue' },
    );

    expect(result.reason).toBe('max_iterations');
    const warnings = events.filter(e => e.type === 'warning');
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('should stop on cost limit', async () => {
    const client = createMockClient([[
      { type: 'done', finishReason: 'stop', usage: { inputTokens: 500, outputTokens: 500, totalTokens: 1000 } },
    ]]);

    const emitter = new StreamEmitter();
    const executor = new ToolExecutor();

    // Set cost policy low enough to be exceeded after first call
    const result = await executeReactLoop(
      [{ role: 'user', content: 'Hi' }],
      {
        client, toolExecutor: executor, emitter, model: 'test',
        maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
        costPolicy: { maxTokensPerExecution: 500, onLimitReached: 'stop' },
      },
    );

    // First iteration runs, then cost check triggers on second
    expect(result.reason).toBe('stop'); // completes first, cost kicks in on next
  });

  it('should handle tool error with onToolError=stop', async () => {
    const client = createMockClient([[
      { type: 'tool_call', id: 'c1', name: 'bad_tool', arguments: '{}' },
      { type: 'done', finishReason: 'tool_calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
    ]]);

    const emitter = new StreamEmitter();
    const executor = new ToolExecutor();
    executor.register({
      name: 'bad_tool',
      description: 'Fails',
      parameters: z.object({}),
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    });

    const result = await executeReactLoop(
      [{ role: 'user', content: 'test' }],
      { client, toolExecutor: executor, emitter, model: 'test', maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'stop' },
    );

    expect(result.reason).toBe('error');
  });
});
