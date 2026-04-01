import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenRouterClient } from '../../../src/llm/openrouter-client.js';
import type { StreamChunk } from '../../../src/llm/message-types.js';

function createSSEResponse(events: string[]): Response {
  const text = events.join('\n\n') + '\n\n';
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function mockFetch(response: Response) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

describe('OpenRouterClient', () => {
  let client: OpenRouterClient;

  beforeEach(() => {
    client = new OpenRouterClient({ apiKey: 'test-key', model: 'test/model', baseUrl: 'https://api.test.com/v1' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('chat()', () => {
    it('should return a complete chat response', async () => {
      const fetchSpy = mockFetch(new Response(JSON.stringify({
        choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), { status: 200 }));

      const result = await client.chat({ messages: [{ role: 'user', content: 'Hi' }] });

      expect(result.content).toBe('Hello!');
      expect(result.finishReason).toBe('stop');
      expect(result.usage.totalTokens).toBe(15);
      expect(fetchSpy).toHaveBeenCalledOnce();

      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(url).toBe('https://api.test.com/v1/chat/completions');
      expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-key' });
    });

    it('should include tools when provided', async () => {
      const fetchSpy = mockFetch(new Response(JSON.stringify({
        choices: [{ message: { content: '' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }), { status: 200 }));

      await client.chat({
        messages: [{ role: 'user', content: 'Hi' }],
        tools: [{ type: 'function', function: { name: 'test', description: 'test', parameters: {} } }],
      });

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.tools).toHaveLength(1);
      expect(body.tools[0].function.name).toBe('test');
    });

    it('should throw on non-retryable HTTP errors', async () => {
      mockFetch(new Response('Bad Request', { status: 400 }));

      await expect(client.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow('OpenRouter API error 400');
    });
  });

  describe('streamChat()', () => {
    it('should yield text content chunks', async () => {
      const sseResponse = createSSEResponse([
        'data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}',
        'data: {"choices":[{"delta":{"content":" world"},"index":0}]}',
        'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}',
      ]);
      mockFetch(sseResponse);

      const chunks: StreamChunk[] = [];
      for await (const chunk of client.streamChat({ messages: [{ role: 'user', content: 'Hi' }] })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(3);
      expect(chunks[0]).toEqual({ type: 'content', data: 'Hello' });
      expect(chunks[1]).toEqual({ type: 'content', data: ' world' });
      expect(chunks[2]).toMatchObject({ type: 'done', finishReason: 'stop' });
    });

    it('should accumulate and yield tool calls', async () => {
      const sseResponse = createSSEResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":""}}]},"index":0}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":\\"NYC\\"}"}}]},"index":0}]}',
        'data: {"choices":[{"finish_reason":"tool_calls","index":0}]}',
      ]);
      mockFetch(sseResponse);

      const chunks: StreamChunk[] = [];
      for await (const chunk of client.streamChat({ messages: [{ role: 'user', content: 'weather' }] })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2); // tool_call + done
      expect(chunks[0]).toEqual({
        type: 'tool_call',
        id: 'call_1',
        name: 'get_weather',
        arguments: '{"city":"NYC"}',
      });
      expect(chunks[1]).toMatchObject({ type: 'done', finishReason: 'tool_calls' });
    });

    it('should handle [DONE] SSE marker', async () => {
      const sseResponse = createSSEResponse([
        'data: {"choices":[{"delta":{"content":"Hi"},"index":0}]}',
        'data: [DONE]',
      ]);
      mockFetch(sseResponse);

      const chunks: StreamChunk[] = [];
      for await (const chunk of client.streamChat({ messages: [{ role: 'user', content: 'Hi' }] })) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual({ type: 'content', data: 'Hi' });
    });
  });

  describe('embed()', () => {
    it('should return embedding vectors', async () => {
      mockFetch(new Response(JSON.stringify({
        data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
      }), { status: 200 }));

      const result = await client.embed(['hello', 'world']);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual([0.1, 0.2, 0.3]);
    });
  });

  describe('reasoning', () => {
    it('should convert system messages for o1 models', async () => {
      const o1Client = new OpenRouterClient({ apiKey: 'test', model: 'openai/o1-preview', baseUrl: 'https://api.test.com/v1' });
      const fetchSpy = mockFetch(new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }), { status: 200 }));

      await o1Client.chat({ messages: [{ role: 'system', content: 'You are helpful' }] });

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.messages[0].role).toBe('user');
    });
  });
});
