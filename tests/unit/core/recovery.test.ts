import { describe, it, expect, vi } from 'vitest';
import { executeReactLoop } from '../../../src/core/react-loop.js';
import { ToolExecutor } from '../../../src/tools/tool-executor.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';
import type { StreamChunk } from '../../../src/llm/message-types.js';
import type { AgentEvent } from '../../../src/contracts/entities/agent-event.js';
import type { Terminal } from '../../../src/core/loop-types.js';
import { PromptTooLongError, OverloadedError } from '../../../src/llm/errors.js';

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

describe('Recovery Mechanisms', () => {
  describe('Prompt Too Long (413) Recovery', () => {
    it('should attempt autocompact on PTL error and retry', async () => {
      let callCount = 0;
      const client = {
        streamChat: vi.fn(async function* () {
          callCount++;
          if (callCount === 1) {
            throw new PromptTooLongError('Prompt too long');
          }
          // Second call succeeds after compaction
          yield { type: 'content', data: 'Recovered!' } as StreamChunk;
          yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } as StreamChunk;
        }),
        chat: vi.fn().mockResolvedValue({
          content: 'Conversation summary.',
          finishReason: 'stop',
          usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
        }),
      } as unknown as LLMClient;

      const executor = new ToolExecutor();

      // Need enough messages to make compaction possible (more than tailProtection=4)
      const messages = [
        { role: 'user' as const, content: 'first question '.repeat(200) },
        { role: 'assistant' as const, content: 'first answer '.repeat(200) },
        { role: 'user' as const, content: 'second question '.repeat(100) },
        { role: 'assistant' as const, content: 'second answer '.repeat(100) },
        { role: 'user' as const, content: 'third question '.repeat(100) },
        { role: 'assistant' as const, content: 'third answer '.repeat(100) },
        { role: 'user' as const, content: 'current question' },
      ];

      const gen = executeReactLoop(messages, {
        client,
        toolExecutor: executor,
        model: 'test',
        maxIterations: 10,
        maxConsecutiveErrors: 3,
        onToolError: 'continue',
        maxContextTokens: 500,
        compactionThreshold: 0.3,
      });

      const { events, terminal } = await consumeLoop(gen);

      expect(terminal.reason).toBe('stop');
      // Should have a recovery event
      const recoveryEvents = events.filter(e => e.type === 'recovery');
      expect(recoveryEvents.length).toBeGreaterThan(0);
    });

    it('should return prompt_too_long when compaction fails', async () => {
      const client = {
        streamChat: vi.fn(async function* () {
          throw new PromptTooLongError('Prompt too long');
        }),
        chat: vi.fn().mockRejectedValue(new Error('Compaction also failed')),
      } as unknown as LLMClient;

      const executor = new ToolExecutor();
      const gen = executeReactLoop(
        [{ role: 'user', content: 'question '.repeat(200) }],
        {
          client, toolExecutor: executor, model: 'test',
          maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
          maxContextTokens: 500, compactionThreshold: 0.3,
        },
      );

      const { terminal } = await consumeLoop(gen);
      expect(terminal.reason).toBe('prompt_too_long');
    });
  });

  describe('Max Output Tokens Recovery', () => {
    it('should first escalate maxTokens, then use resume message', async () => {
      let callCount = 0;
      const streamChatFn = vi.fn(async function* () {
        callCount++;
        if (callCount === 1) {
          // First call: truncated at default maxTokens
          yield { type: 'content', data: 'Partial...' } as StreamChunk;
          yield { type: 'done', finishReason: 'length', usage: { inputTokens: 10, outputTokens: 100, totalTokens: 110 } } as StreamChunk;
        } else if (callCount === 2) {
          // Second call: escalated maxTokens, still truncated
          yield { type: 'content', data: 'More partial...' } as StreamChunk;
          yield { type: 'done', finishReason: 'length', usage: { inputTokens: 20, outputTokens: 200, totalTokens: 220 } } as StreamChunk;
        } else {
          // Third call: resume message, completes
          yield { type: 'content', data: ' done!' } as StreamChunk;
          yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 30, outputTokens: 50, totalTokens: 80 } } as StreamChunk;
        }
      });

      const client = { streamChat: streamChatFn } as unknown as LLMClient;
      const executor = new ToolExecutor();
      const gen = executeReactLoop(
        [{ role: 'user', content: 'Write something long' }],
        {
          client, toolExecutor: executor, model: 'test',
          maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
          maxOutputTokens: 4096,
          escalatedMaxOutputTokens: 16384,
        },
      );

      const { events, terminal } = await consumeLoop(gen);

      expect(terminal.reason).toBe('stop');
      expect(callCount).toBe(3);

      const recoveryEvents = events.filter(e => e.type === 'recovery');
      // First recovery: escalate, second: resume message
      expect(recoveryEvents).toHaveLength(2);
      expect((recoveryEvents[0] as { reason: string }).reason).toBe('max_output_tokens_escalate');
      expect((recoveryEvents[1] as { reason: string }).reason).toBe('max_output_tokens_recovery');

      // Second call should have received escalated maxTokens
      const secondCallArgs = streamChatFn.mock.calls[1]![0];
      expect(secondCallArgs.maxTokens).toBe(16384);
    });

    it('should inject resume message when output is truncated', async () => {
      let callCount = 0;
      const client = {
        streamChat: vi.fn(async function* () {
          callCount++;
          if (callCount === 1) {
            yield { type: 'content', data: 'Partial response...' } as StreamChunk;
            yield { type: 'done', finishReason: 'length', usage: { inputTokens: 10, outputTokens: 100, totalTokens: 110 } } as StreamChunk;
          } else {
            yield { type: 'content', data: ' completed!' } as StreamChunk;
            yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 } } as StreamChunk;
          }
        }),
      } as unknown as LLMClient;

      const executor = new ToolExecutor();
      const gen = executeReactLoop(
        [{ role: 'user', content: 'Write something long' }],
        {
          client, toolExecutor: executor, model: 'test',
          maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
        },
      );

      const { events, terminal } = await consumeLoop(gen);

      expect(terminal.reason).toBe('stop');
      // Should have recovery event
      const recoveryEvents = events.filter(e => e.type === 'recovery');
      expect(recoveryEvents.length).toBeGreaterThan(0);
    });

    it('should give up after max recovery attempts', async () => {
      const client = {
        streamChat: vi.fn(async function* () {
          yield { type: 'content', data: 'Partial...' } as StreamChunk;
          yield { type: 'done', finishReason: 'length', usage: { inputTokens: 10, outputTokens: 100, totalTokens: 110 } } as StreamChunk;
        }),
      } as unknown as LLMClient;

      const executor = new ToolExecutor();
      const gen = executeReactLoop(
        [{ role: 'user', content: 'Write something' }],
        {
          client, toolExecutor: executor, model: 'test',
          maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
        },
      );

      const { terminal } = await consumeLoop(gen);
      expect(terminal.reason).toBe('max_output_tokens');
    });
  });

  describe('Model Fallback', () => {
    it('should switch to fallback model on overload error', async () => {
      let callCount = 0;
      const client = {
        streamChat: vi.fn(async function* () {
          callCount++;
          if (callCount === 1) {
            throw new OverloadedError('Model overloaded');
          }
          yield { type: 'content', data: 'Fallback response' } as StreamChunk;
          yield { type: 'done', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } as StreamChunk;
        }),
      } as unknown as LLMClient;

      const executor = new ToolExecutor();
      const gen = executeReactLoop(
        [{ role: 'user', content: 'test' }],
        {
          client, toolExecutor: executor, model: 'primary-model',
          maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
          fallbackModel: 'fallback-model',
        },
      );

      const { events, terminal } = await consumeLoop(gen);

      expect(terminal.reason).toBe('stop');
      // Should have used fallback model
      const fallbackEvents = events.filter(e => e.type === 'model_fallback');
      expect(fallbackEvents.length).toBeGreaterThan(0);
    });

    it('should fail normally when no fallback model configured', async () => {
      const client = {
        streamChat: vi.fn(async function* () {
          throw new OverloadedError('Model overloaded');
        }),
      } as unknown as LLMClient;

      const executor = new ToolExecutor();
      const gen = executeReactLoop(
        [{ role: 'user', content: 'test' }],
        {
          client, toolExecutor: executor, model: 'test',
          maxIterations: 10, maxConsecutiveErrors: 3, onToolError: 'continue',
          // No fallbackModel
        },
      );

      const { terminal } = await consumeLoop(gen);
      expect(terminal.reason).toBe('error');
    });
  });
});
