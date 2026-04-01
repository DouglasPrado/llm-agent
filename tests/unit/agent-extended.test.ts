import { describe, it, expect, vi, afterEach } from 'vitest';
import { Agent } from '../../src/agent.js';
import { z } from 'zod';

describe('Agent — extended API (divergence fixes)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removeTool() should unregister a tool', () => {
    const agent = Agent.create({ apiKey: 'test-key', memory: { enabled: false }, knowledge: { enabled: false } });
    agent.addTool({
      name: 'temp',
      description: 'temporary',
      parameters: z.object({}),
      execute: async () => 'ok',
    });

    const removed = agent.removeTool('temp');
    expect(removed).toBe(true);
  });

  it('removeTool() should return false for unknown tool', () => {
    const agent = Agent.create({ apiKey: 'test-key', memory: { enabled: false }, knowledge: { enabled: false } });
    expect(agent.removeTool('nonexistent')).toBe(false);
  });

  it('getHistory() should return conversation history', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hi"},"index":0}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
    ].join('');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/embeddings')) {
        return new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 });
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseData));
            controller.close();
          },
        }),
        { status: 200 },
      );
    });

    const agent = Agent.create({ apiKey: 'test-key', memory: { enabled: false }, knowledge: { enabled: false } });
    await agent.chat('Hello');

    const history = agent.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0]!.role).toBe('user');
    expect(history[0]!.content).toBe('Hello');
  });

  it('connectMCP() should attempt connection (errors without valid server)', async () => {
    const agent = Agent.create({ apiKey: 'test-key', memory: { enabled: false }, knowledge: { enabled: false } });
    // Without a valid command, stdio transport will fail
    await expect(agent.connectMCP({ name: 'test', transport: 'stdio', command: '__nonexistent__' })).rejects.toThrow();
  });

  it('disconnectMCP() should throw for unknown server', async () => {
    const agent = Agent.create({ apiKey: 'test-key', memory: { enabled: false }, knowledge: { enabled: false } });
    await expect(agent.disconnectMCP('nonexistent')).rejects.toThrow('not found');
  });

  it('getUsage() should track session-level cost across multiple calls', async () => {
    const makeSSE = (tokens: number) => [
      `data: {"choices":[{"delta":{"content":"ok"},"index":0}]}\n\n`,
      `data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":${tokens},"completion_tokens":${tokens},"total_tokens":${tokens * 2}}}\n\n`,
    ].join('');

    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/embeddings')) {
        return new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 });
      }
      callCount++;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(makeSSE(10 * callCount)));
            controller.close();
          },
        }),
        { status: 200 },
      );
    });

    const agent = Agent.create({ apiKey: 'test-key', memory: { enabled: false }, knowledge: { enabled: false } });

    await agent.chat('first');
    await agent.chat('second');

    const usage = agent.getUsage();
    expect(usage.totalTokens).toBeGreaterThan(0);
    // Should be sum of both calls
    expect(usage.inputTokens).toBeGreaterThan(10);
  });

  it('structured output: responseFormat should be passed through', async () => {
    // This tests UC-009 — structured output passthrough
    const sseData = [
      'data: {"choices":[{"delta":{"content":"{\\"name\\":\\"test\\"}"},"index":0}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":5,"completion_tokens":5,"total_tokens":10}}\n\n',
    ].join('');

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/embeddings')) {
        return new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 });
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseData));
            controller.close();
          },
        }),
        { status: 200 },
      );
    });

    // Verify at the OpenRouterClient level that responseFormat is accepted
    const { OpenRouterClient } = await import('../../src/llm/openrouter-client.js');
    const client = new OpenRouterClient({ apiKey: 'test', model: 'test/model', baseUrl: 'https://api.test.com/v1' });

    const chunks = [];
    for await (const chunk of client.streamChat({
      messages: [{ role: 'user', content: 'give json' }],
      responseFormat: { type: 'json_object' },
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);

    // Verify responseFormat was sent in the body
    const chatCall = fetchSpy.mock.calls.find(c => {
      const u = typeof c[0] === 'string' ? c[0] : '';
      return u.includes('/chat/completions');
    });
    const body = JSON.parse((chatCall![1] as RequestInit).body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });
});
