import type {
  StreamChatParams,
  ChatParams,
  StreamChunk,
  ChatResponse,
  OpenRouterToolCall,
} from './message-types.js';
import type { TokenUsage } from '../contracts/entities/token-usage.js';
import { retry } from '../utils/retry.js';
import { buildReasoningArgs, requiresNoSystemRole } from './reasoning.js';

export interface OpenRouterClientConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: OpenRouterClientConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = (config.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  }

  async *streamChat(params: StreamChatParams): AsyncIterableIterator<StreamChunk> {
    const model = params.model ?? this.model;
    const reasoningArgs = buildReasoningArgs(model);

    let messages = params.messages;
    if (requiresNoSystemRole(model)) {
      messages = messages.map(m =>
        m.role === 'system' ? { ...m, role: 'user' as const } : m
      );
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      ...reasoningArgs,
    };

    if (params.tools?.length) body.tools = params.tools;
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.responseFormat) body.response_format = params.responseFormat;
    if (params.seed !== undefined) body.seed = params.seed;
    if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;

    const response = await retry(
      () => this.fetchAPI('/chat/completions', body, params.signal),
      { maxRetries: 3, initialDelay: 1000, isRetryable: (e) => e instanceof RetryableError },
    );

    yield* this.parseSSEStream(response, params.signal);
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const model = params.model ?? this.model;
    const reasoningArgs = buildReasoningArgs(model);

    let messages = params.messages;
    if (requiresNoSystemRole(model)) {
      messages = messages.map(m =>
        m.role === 'system' ? { ...m, role: 'user' as const } : m
      );
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      ...reasoningArgs,
    };

    if (params.tools?.length) body.tools = params.tools;
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.responseFormat) body.response_format = params.responseFormat;
    if (params.seed !== undefined) body.seed = params.seed;
    if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;

    const response = await retry(
      () => this.fetchAPI('/chat/completions', body, params.signal),
      { maxRetries: 3, initialDelay: 1000, isRetryable: (e) => e instanceof RetryableError },
    );

    const json = await response.json() as {
      choices: Array<{
        message: { content?: string; tool_calls?: OpenRouterToolCall[] };
        finish_reason: string;
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };

    const choice = json.choices[0]!;
    const usage: TokenUsage = {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      totalTokens: json.usage?.total_tokens ?? 0,
    };

    return {
      content: choice.message.content ?? '',
      toolCalls: choice.message.tool_calls,
      finishReason: choice.finish_reason,
      usage,
    };
  }

  async embed(texts: string[], model?: string): Promise<number[][]> {
    const response = await retry(
      () => this.fetchAPI('/embeddings', {
        model: model ?? 'openai/text-embedding-3-small',
        input: texts,
      }),
      { maxRetries: 3, initialDelay: 1000, isRetryable: (e) => e instanceof RetryableError },
    );

    const json = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return json.data.map(d => d.embedding);
  }

  private async fetchAPI(path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      if (isRetryableStatus(response.status)) {
        throw new RetryableError(`OpenRouter API error: ${response.status}`);
      }
      const text = await response.text().catch(() => '');
      throw new Error(`OpenRouter API error ${response.status}: ${text}`);
    }

    return response;
  }

  private async *parseSSEStream(response: Response, signal?: AbortSignal): AsyncIterableIterator<StreamChunk> {
    const body = response.body;
    if (!body) throw new Error('Response body is null');

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Accumulate tool calls incrementally
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      while (true) {
        if (signal?.aborted) break;

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (!trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);

          if (data === '[DONE]') {
            return;
          }

          let parsed: SSEPayload;
          try {
            parsed = JSON.parse(data) as SSEPayload;
          } catch {
            continue;
          }

          const choice = parsed.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta;

          // Text content
          if (delta?.content) {
            yield { type: 'content', data: delta.content };
          }

          // Reasoning content
          if (delta?.reasoning) {
            yield { type: 'reasoning', data: delta.reasoning };
          }

          // Tool calls (accumulated incrementally)
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCalls.get(tc.index);
              if (!existing) {
                const entry = {
                  id: tc.id ?? '',
                  name: tc.function?.name ?? '',
                  arguments: tc.function?.arguments ?? '',
                };
                toolCalls.set(tc.index, entry);
              } else {
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name += tc.function.name;
                if (tc.function?.arguments) existing.arguments += tc.function.arguments;
              }
            }
          }

          // Done
          if (choice.finish_reason) {
            // Emit accumulated tool calls
            for (const tc of toolCalls.values()) {
              yield { type: 'tool_call', id: tc.id, name: tc.name, arguments: tc.arguments };
            }

            const usage: TokenUsage | undefined = parsed.usage ? {
              inputTokens: parsed.usage.prompt_tokens,
              outputTokens: parsed.usage.completion_tokens,
              totalTokens: parsed.usage.total_tokens,
            } : undefined;

            yield { type: 'done', finishReason: choice.finish_reason, usage };
            return;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

interface SSEPayload {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
