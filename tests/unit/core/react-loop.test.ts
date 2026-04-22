import { describe, it, expect, vi } from 'vitest';
import { executeReactLoop } from '../../../src/core/react-loop.js';
import { ToolExecutor } from '../../../src/tools/tool-executor.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';
import type { StreamChunk, LLMMessage } from '../../../src/llm/message-types.js';
import type { AgentEvent } from '../../../src/contracts/entities/agent-event.js';
import type { Terminal } from '../../../src/core/loop-types.js';
import { SKILL_TOOL_NAME } from '../../../src/tools/skill-tool.js';
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

describe('executeReactLoop', () => {
  it('should complete a simple text response', async () => {
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

  it('should execute tool calls and continue loop', async () => {
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
    });

    const gen = executeReactLoop(
      [{ role: 'user', content: 'Weather in NYC?' }],
      { client, toolExecutor: executor, model: 'test', maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue' },
    );

    const { events, terminal } = await consumeLoop(gen);

    expect(terminal.reason).toBe('stop');
    expect(terminal.usage.totalTokens).toBe(45);

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

  it('should stop on cost limit', async () => {
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

  it('should include all tool results in messages even when tools complete during streaming', async () => {
    // Bug: tools that complete while LLM is still streaming get yielded as events
    // but their results are NOT added to the conversation history (toolResultMessages).
    // getRemainingResults() skips 'yielded' tools, so the next LLM call is missing tool results.
    // OpenAI returns: "No tool output found for function call X"

    let capturedMessages: unknown[] = [];
    const client = {
      streamChat: vi.fn(async function* (params: { messages: unknown[] }) {
        capturedMessages = params.messages;
        // Turn 1: two tool calls
        if ((client.streamChat as ReturnType<typeof vi.fn>).mock.calls.length === 1) {
          yield { type: 'tool_call', id: 'call_a', name: 'fast_tool', arguments: '{}' };
          // Simulate delay so fast_tool completes during streaming
          await new Promise(r => setTimeout(r, 10));
          yield { type: 'tool_call', id: 'call_b', name: 'fast_tool', arguments: '{}' };
          yield { type: 'done', finishReason: 'tool_calls', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
        } else {
          // Turn 2: text response
          yield { type: 'content', data: 'Done' };
          yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 20, outputTokens: 2, totalTokens: 22 } };
        }
      }),
    } as unknown as LLMClient;

    const executor = new ToolExecutor();
    executor.register({
      name: 'fast_tool',
      description: 'Completes instantly',
      parameters: z.object({}),
      execute: vi.fn().mockResolvedValue('result_ok'),
    });

    const gen = executeReactLoop(
      [{ role: 'user', content: 'test' }],
      { client, toolExecutor: executor, model: 'test', maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue' },
    );

    const { terminal } = await consumeLoop(gen);
    expect(terminal.reason).toBe('stop');

    // The second LLM call must include tool results for BOTH call_a and call_b
    const toolMessages = (capturedMessages as Array<{ role: string; tool_call_id?: string }>)
      .filter(m => m.role === 'tool');
    expect(toolMessages).toHaveLength(2);
    expect(toolMessages.map(m => m.tool_call_id)).toEqual(
      expect.arrayContaining(['call_a', 'call_b']),
    );
  });

  it('preserves message order on turn 2 after Skill tool call (pinned tool result stays after assistant)', async () => {
    // Regression for the bug: the Skill tool result is marked _pinned, and downstream
    // compaction/normalization steps used to reorder [system, pinned, rest] which placed
    // the tool result BEFORE the assistant message with tool_calls — violating OpenAI's
    // invariant that `tool` messages must be preceded by an assistant message with
    // matching `tool_calls`. The API rejected turn 2 with
    //   "messages with role 'tool' must be a response to a preceeding message with 'tool_calls'".
    let capturedMessages: LLMMessage[] = [];
    const client = {
      streamChat: vi.fn(async function* (params: { messages: LLMMessage[] }) {
        capturedMessages = params.messages;
        const n = (client.streamChat as ReturnType<typeof vi.fn>).mock.calls.length;
        if (n === 1) {
          yield { type: 'tool_call', id: 'skill-1', name: SKILL_TOOL_NAME, arguments: '{"skill":"albert-api"}' };
          yield { type: 'done', finishReason: 'tool_calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
        } else {
          yield { type: 'content', data: 'ok' };
          yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
        }
      }),
    } as unknown as LLMClient;

    const executor = new ToolExecutor();
    executor.register({
      name: SKILL_TOOL_NAME,
      description: 'Skill tool',
      parameters: z.object({ skill: z.string() }),
      execute: vi.fn().mockResolvedValue('<skill name="albert-api">instructions</skill>'),
    });

    const initial: LLMMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: '/testarapi' },
    ];
    const gen = executeReactLoop(initial, {
      client,
      toolExecutor: executor,
      model: 'test',
      maxIterations: 10,
      maxConsecutiveErrors: 3,
      onToolError: 'continue',
    });

    const { terminal } = await consumeLoop(gen);
    expect(terminal.reason).toBe('stop');

    // On turn 2, messages sent to LLM must be in the canonical order
    // [system, user, assistant(tool_calls), tool].
    expect(capturedMessages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    const assistantIdx = capturedMessages.findIndex(m => m.role === 'assistant' && !!m.tool_calls);
    const toolIdx = capturedMessages.findIndex(m => m.role === 'tool');
    expect(toolIdx).toBe(assistantIdx + 1);
  });

  it('should handle tool error with onToolError=stop', async () => {
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
