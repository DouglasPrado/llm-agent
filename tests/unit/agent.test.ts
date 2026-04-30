import { describe, it, expect, vi, afterEach } from 'vitest';
import { Agent } from '../../src/agent.js';
import type { AgentEvent } from '../../src/contracts/entities/agent-event.js';

describe('Agent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create an agent with valid config', () => {
    const agent = Agent.create({ apiKey: 'test-key' });
    expect(agent).toBeDefined();
  });

  it('should reject empty apiKey', () => {
    expect(() => Agent.create({ apiKey: '' })).toThrow();
  });

  it('should register tools', () => {
    const agent = Agent.create({ apiKey: 'test-key' });
    const { z } = require('zod');
    agent.addTool({
      name: 'test',
      description: 'test tool',
      parameters: z.object({ input: z.string() }),
      execute: async () => 'result',
    });
    // No error thrown
  });

  it('should register skills', () => {
    const agent = Agent.create({ apiKey: 'test-key' });
    agent.addSkill({
      name: 'test-skill',
      description: 'A skill',
      instructions: 'Do something',
    });
  });

  it('should return empty usage initially', () => {
    const agent = Agent.create({ apiKey: 'test-key' });
    const usage = agent.getUsage();
    expect(usage.totalTokens).toBe(0);
  });

  it('should stream events on chat', async () => {
    // Mock fetch for streaming
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hello!"},"index":0}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
    ].join('');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/embeddings')) {
        return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 });
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseData));
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    });

    const agent = Agent.create({
      apiKey: 'test-key',
      memory: { enabled: false },
      knowledge: { enabled: false },
    });

    const events: AgentEvent[] = [];
    for await (const event of agent.stream('Hi')) {
      events.push(event);
    }

    expect(events.some(e => e.type === 'agent_start')).toBe(true);
    expect(events.some(e => e.type === 'text_delta')).toBe(true);
    expect(events.some(e => e.type === 'agent_end')).toBe(true);

    const usage = agent.getUsage();
    expect(usage.totalTokens).toBe(7);
  });

  it('should return text via chat()', async () => {
    const sseData = [
      'data: {"choices":[{"delta":{"content":"Hello world!"},"index":0}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}\n\n',
    ].join('');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/embeddings')) {
        return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 });
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
      memory: { enabled: false },
      knowledge: { enabled: false },
    });

    const result = await agent.chat('Hi');
    expect(result).toBe('Hello world!');
  });

  it('should destroy cleanly', async () => {
    const agent = Agent.create({ apiKey: 'test-key' });
    await agent.destroy();

    // Should throw after destroy
    await expect(async () => {
      for await (const _ of agent.stream('Hi')) { /* consume */ }
    }).rejects.toThrow('destroyed');
  });

  it('should remember and recall explicitly (file-based)', async () => {
    const agent = Agent.create({ apiKey: 'test-key' });
    const filename = await agent.remember('User prefers dark mode');
    expect(typeof filename).toBe('string');
    expect(filename).toMatch(/\.md$/);
  });

  it('should emit console.warn (not debug) when memoryDir initialization fails (issue #30)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // /dev/null/memory is always uncreateable (ENOTDIR) — forces ensureDir() to fail
    Agent.create({
      apiKey: 'test-key',
      logLevel: 'info',  // info threshold: debug is suppressed, warn is emitted
      memory: { enabled: true, memoryDir: '/dev/null/memory' },
      knowledge: { enabled: false },
    });

    // Fire-and-forget — let the promise settle
    await new Promise(r => setTimeout(r, 100));

    const memoryWarn = warnSpy.mock.calls.find(c => String(c[0]).toLowerCase().includes('memory'));
    expect(memoryWarn).toBeDefined();
    warnSpy.mockRestore();
  });

  it('should emit console.warn (not debug) when skillsDir loading fails (issue #30)', async () => {
    const { SkillManager } = await import('../../src/skills/skill-manager.js');
    const loadSpy = vi.spyOn(SkillManager.prototype, 'loadFromDirectory')
      .mockRejectedValue(new Error('EACCES: permission denied'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    Agent.create({
      apiKey: 'test-key',
      logLevel: 'info',
      memory: { enabled: false },
      knowledge: { enabled: false },
      skills: { skillsDir: '/some/restricted/skills' },
    });

    await new Promise(r => setTimeout(r, 100));

    const skillsWarn = warnSpy.mock.calls.find(c => String(c[0]).toLowerCase().includes('skill'));
    expect(skillsWarn).toBeDefined();
    loadSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
