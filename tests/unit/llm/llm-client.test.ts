import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMClient } from '../../../src/llm/llm-client.js';
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

describe('LLMClient', () => {
  let client: LLMClient;

  beforeEach(() => {
    client = new LLMClient({ apiKey: 'test-key', model: 'test/model', baseUrl: 'https://api.test.com/v1' });
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

    it('should send max_completion_tokens for reasoning models (gpt-5)', async () => {
      const fetchSpy = mockFetch(new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200 }));

      await client.chat({
        model: 'openai/gpt-5.4',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 512,
      });

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.max_completion_tokens).toBe(512);
      expect(body.max_tokens).toBeUndefined();
    });

    it('should send max_tokens for non-reasoning models', async () => {
      const fetchSpy = mockFetch(new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200 }));

      await client.chat({
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: 'Hi' }],
        maxTokens: 512,
      });

      const body = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.max_tokens).toBe(512);
      expect(body.max_completion_tokens).toBeUndefined();
    });

    it('should throw on non-retryable HTTP errors', async () => {
      mockFetch(new Response('Bad Request', { status: 400 }));

      await expect(client.chat({
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow('LLM API error 400');
    });

    it('should truncate large error bodies to avoid leaking conversation content (issue #8)', async () => {
      // Simulate an API that echoes request content in error messages (e.g. OpenRouter)
      const sensitiveContent = 'SENSITIVE_USER_DATA: ' + 'x'.repeat(1000);
      mockFetch(new Response(sensitiveContent, { status: 400 }));

      let errorMessage = '';
      try {
        await client.chat({ messages: [{ role: 'user', content: 'Hi' }] });
      } catch (e) {
        errorMessage = (e as Error).message;
      }

      // Error must not include the full 1000-char sensitive body
      expect(errorMessage.length).toBeLessThan(600);
      expect(errorMessage).not.toContain('x'.repeat(600));
    });

    it('should extract structured error message from JSON error body (issue #8)', async () => {
      const jsonBody = JSON.stringify({
        error: { message: 'Model context limit exceeded', code: 400 },
      });
      mockFetch(new Response(jsonBody, { status: 400 }));

      let errorMessage = '';
      try {
        await client.chat({ messages: [{ role: 'user', content: 'Hi' }] });
      } catch (e) {
        errorMessage = (e as Error).message;
      }

      // Should extract the structured message, not include raw JSON envelope
      expect(errorMessage).toContain('Model context limit exceeded');
      expect(errorMessage).not.toContain('"error"');
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

  describe('resilience', () => {
    it('chat() throws a clear error on malformed JSON response body', async () => {
      mockFetch(new Response('not json', { status: 200 }));
      await expect(
        client.chat({ messages: [{ role: 'user', content: 'Hi' }] }),
      ).rejects.toThrow(/parse/i);
    });

    it('embed() throws a clear error on malformed JSON response body', async () => {
      mockFetch(new Response('not json', { status: 200 }));
      await expect(client.embed(['hello'])).rejects.toThrow(/parse/i);
    });

    it('streamChat cancels the reader when signal is aborted mid-stream', async () => {
      const cancelSpy = vi.fn().mockResolvedValue(undefined);
      const neverReader = {
        read: () => new Promise(() => { /* hang */ }),
        releaseLock: vi.fn(),
        cancel: cancelSpy,
        closed: Promise.resolve(undefined),
      };
      const fakeBody = { getReader: () => neverReader } as unknown as ReadableStream<Uint8Array>;
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, 'body', { value: fakeBody });
      mockFetch(response);

      const controller = new AbortController();
      const iter = client.streamChat({
        messages: [{ role: 'user', content: 'Hi' }],
        signal: controller.signal,
      });

      const consume = (async () => {
        // Start consuming; the first read will hang
        for await (const _ of iter) { /* no-op */ }
      })();

      // Abort after next tick so the stream is actively reading
      await new Promise(r => setTimeout(r, 10));
      controller.abort();

      // The iterator should settle without hanging, and cancel must be called
      await Promise.race([
        consume,
        new Promise((_, reject) => setTimeout(() => reject(new Error('hung')), 500)),
      ]).catch(() => { /* iterator may throw on abort — both OK */ });

      expect(cancelSpy).toHaveBeenCalled();
    });

    it('applies a default fetch timeout when caller provides no signal', async () => {
      const fetchSpy = mockFetch(new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }), { status: 200 }));

      await client.chat({ messages: [{ role: 'user', content: 'Hi' }] });

      const init = fetchSpy.mock.calls[0]![1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('uses timeoutMs from LLMClientConfig instead of hardcoded default (issue #29)', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customClient = new LLMClient({
        apiKey: 'test-key', model: 'test/model', baseUrl: 'https://api.test.com/v1',
        timeoutMs: 30_000,
      } as any);
      mockFetch(new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }), { status: 200 }));

      await customClient.chat({ messages: [{ role: 'user', content: 'Hi' }] });

      expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    });

    it('uses default 120000ms timeout when timeoutMs is not specified (issue #29)', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      mockFetch(new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }), { status: 200 }));

      await client.chat({ messages: [{ role: 'user', content: 'Hi' }] });

      expect(timeoutSpy).toHaveBeenCalledWith(120_000);
    });

    it('flushes UTF-8 decoder at end of stream so no trailing bytes are dropped', async () => {
      // Build a response whose last chunk is the continuation of a multibyte char.
      // The emoji '😀' is 4 bytes in UTF-8: 0xF0 0x9F 0x98 0x80
      const encoder = new TextEncoder();
      const head = encoder.encode('data: {"choices":[{"delta":{"content":"Hi '); // partial JSON
      const emojiBytes = encoder.encode('😀');
      const tail = encoder.encode('"},"index":0}]}\n\ndata: {"choices":[{"finish_reason":"stop","index":0}]}\n\n');

      // Split the emoji in the middle across two chunks
      const first = new Uint8Array([...head, ...emojiBytes.slice(0, 2)]);
      const second = new Uint8Array([...emojiBytes.slice(2), ...tail]);

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(first);
          controller.enqueue(second);
          controller.close();
        },
      });
      const response = new Response(stream, { status: 200 });
      mockFetch(response);

      const chunks: StreamChunk[] = [];
      for await (const chunk of client.streamChat({ messages: [{ role: 'user', content: 'Hi' }] })) {
        chunks.push(chunk);
      }

      const content = chunks
        .filter(c => c.type === 'content')
        .map(c => (c as { type: 'content'; data: string }).data)
        .join('');
      expect(content).toContain('😀');
    });
  });

  describe('reasoning', () => {
    it('should convert system messages for o1 models', async () => {
      const o1Client = new LLMClient({ apiKey: 'test', model: 'openai/o1-preview', baseUrl: 'https://api.test.com/v1' });
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
