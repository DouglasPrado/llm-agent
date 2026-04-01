import type { OpenRouterClient } from '../llm/openrouter-client.js';
import type { ToolExecutor } from '../tools/tool-executor.js';
import type { StreamEmitter } from './stream-emitter.js';
import type { OpenRouterMessage } from '../llm/message-types.js';
import type { TokenUsage } from '../contracts/entities/token-usage.js';
import type { OnToolError } from '../contracts/enums/index.js';

export interface ReactLoopConfig {
  client: OpenRouterClient;
  toolExecutor: ToolExecutor;
  emitter: StreamEmitter;
  model: string;
  maxIterations: number;
  maxConsecutiveErrors: number;
  onToolError: OnToolError;
  costPolicy?: {
    maxTokensPerExecution?: number;
    onLimitReached: 'stop' | 'warn';
  };
  signal?: AbortSignal;
}

/**
 * ReAct loop: LLM → tool_calls → execute → repeat until text or limit.
 */
export async function executeReactLoop(
  messages: OpenRouterMessage[],
  config: ReactLoopConfig,
): Promise<{ usage: TokenUsage; reason: string }> {
  const { client, toolExecutor, emitter, model, maxIterations, maxConsecutiveErrors, onToolError, costPolicy, signal } = config;

  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let consecutiveErrors = 0;
  const toolDefs = toolExecutor.listTools().length > 0 ? toolExecutor.getToolDefinitions() : undefined;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (signal?.aborted) {
      return { usage, reason: 'abort' };
    }

    // Check cost policy
    if (costPolicy?.maxTokensPerExecution && usage.totalTokens >= costPolicy.maxTokensPerExecution) {
      if (costPolicy.onLimitReached === 'stop') {
        return { usage, reason: 'cost_limit' };
      }
      emitter.emit({ type: 'warning', message: 'Token limit approaching', code: 'cost_warning' });
    }

    emitter.emit({ type: 'turn_start', iteration });

    let fullText = '';
    const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    try {
      for await (const chunk of client.streamChat({ messages, tools: toolDefs, model, signal })) {
        switch (chunk.type) {
          case 'content':
            fullText += chunk.data;
            emitter.emit({ type: 'text_delta', content: chunk.data });
            break;
          case 'tool_call':
            toolCalls.push({ id: chunk.id, name: chunk.name, arguments: chunk.arguments });
            emitter.emit({
              type: 'tool_call_start',
              toolCall: { id: chunk.id, type: 'function', function: { name: chunk.name, arguments: chunk.arguments } },
            });
            break;
          case 'done':
            if (chunk.usage) {
              usage.inputTokens += chunk.usage.inputTokens;
              usage.outputTokens += chunk.usage.outputTokens;
              usage.totalTokens += chunk.usage.totalTokens;
            }
            break;
        }
      }

      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors++;
      emitter.emit({
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
        recoverable: consecutiveErrors < maxConsecutiveErrors,
      });

      if (consecutiveErrors >= maxConsecutiveErrors) {
        return { usage, reason: 'error' };
      }
      continue;
    }

    // Add assistant message to history
    const assistantMessage: OpenRouterMessage = { role: 'assistant', content: fullText };
    if (toolCalls.length > 0) {
      assistantMessage.tool_calls = toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }
    messages.push(assistantMessage);

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      if (fullText) emitter.emit({ type: 'text_done', content: fullText });
      emitter.emit({ type: 'turn_end', iteration, hasToolCalls: false });
      return { usage, reason: 'stop' };
    }

    // Execute tool calls
    emitter.emit({ type: 'turn_end', iteration, hasToolCalls: true });

    for (const tc of toolCalls) {
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(tc.arguments);
      } catch {
        parsedArgs = {};
      }

      const start = Date.now();
      const result = await toolExecutor.execute(tc.name, parsedArgs, signal);
      const duration = Date.now() - start;

      emitter.emit({ type: 'tool_call_end', toolCallId: tc.id, result, duration });

      if (result.isError && onToolError === 'stop') {
        messages.push({ role: 'tool', content: result.content, tool_call_id: tc.id });
        return { usage, reason: 'error' };
      }

      messages.push({ role: 'tool', content: result.content, tool_call_id: tc.id });
    }
  }

  emitter.emit({ type: 'warning', message: 'Max iterations reached', code: 'max_iterations' });
  return { usage, reason: 'max_iterations' };
}
