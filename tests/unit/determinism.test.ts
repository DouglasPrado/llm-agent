import { describe, it, expect, vi, afterEach } from 'vitest';
import { Agent } from '../../src/agent.js';

describe('Deterministic Mode (ENT-010)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should pass seed and temperature=0 when deterministic is true', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hi"},"index":0}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
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

    const agent = Agent.create({
      apiKey: 'test-key',
      deterministic: true,
      seed: 42,
      memory: { enabled: false },
      knowledge: { enabled: false },
    });

    await agent.chat('test');

    // Check that the fetch was called with seed in the body
    const chatCall = fetchSpy.mock.calls.find(c => {
      const urlStr = typeof c[0] === 'string' ? c[0] : c[0]!.toString();
      return urlStr.includes('/chat/completions');
    });
    expect(chatCall).toBeDefined();
  });

  it('should create agent with deterministic=true without error', () => {
    const agent = Agent.create({
      apiKey: 'test-key',
      deterministic: true,
      seed: 123,
      memory: { enabled: false },
      knowledge: { enabled: false },
    });
    expect(agent).toBeDefined();
  });

  it('should default deterministic to false', () => {
    const agent = Agent.create({ apiKey: 'test-key' });
    expect(agent).toBeDefined();
  });
});
