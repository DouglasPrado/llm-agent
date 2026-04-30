import { describe, it, expect, vi } from 'vitest';
import { StreamingToolExecutor } from '../../../src/core/streaming-tool-executor.js';
import { ToolExecutor } from '../../../src/tools/tool-executor.js';
import { z } from 'zod';
import type { AgentTool } from '../../../src/contracts/entities/agent-tool.js';

function createTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: 'test_tool',
    description: 'A test tool',
    parameters: z.object({ input: z.string() }),
    execute: vi.fn().mockResolvedValue('result'),
    ...overrides,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

describe('StreamingToolExecutor', () => {
  it('should execute a tool added during streaming', async () => {
    const executor = new ToolExecutor();
    executor.register(createTool({
      name: 'search',
      isConcurrencySafe: true,
      execute: vi.fn().mockResolvedValue('found it'),
    }));

    const streaming = new StreamingToolExecutor(executor);

    // Simulate: tool call arrives during streaming
    streaming.addTool('call_1', 'search', '{"input":"hello"}');

    // Wait a tick for execution to start
    await delay(10);

    // Collect completed results
    const completed = [...streaming.getCompletedResults()];
    expect(completed).toHaveLength(1);
    expect(completed[0]!.id).toBe('call_1');
    expect(completed[0]!.result.content).toBe('found it');
  });

  it('should execute multiple safe tools concurrently', async () => {
    const executor = new ToolExecutor();
    const order: string[] = [];

    executor.register(createTool({
      name: 'read_a',
      isConcurrencySafe: true,
      execute: vi.fn().mockImplementation(async () => {
        order.push('a:start');
        await delay(50);
        order.push('a:end');
        return 'a';
      }),
    }));

    executor.register(createTool({
      name: 'read_b',
      isConcurrencySafe: true,
      execute: vi.fn().mockImplementation(async () => {
        order.push('b:start');
        await delay(50);
        order.push('b:end');
        return 'b';
      }),
    }));

    const streaming = new StreamingToolExecutor(executor);

    // Add both tools quickly (as if arriving from stream)
    streaming.addTool('c1', 'read_a', '{"input":"x"}');
    streaming.addTool('c2', 'read_b', '{"input":"y"}');

    // Both should start before either finishes
    await delay(10);
    expect(order).toContain('a:start');
    expect(order).toContain('b:start');

    // Get remaining results after streaming ends
    const results: Array<{ id: string; result: { content: string } }> = [];
    for await (const r of streaming.getRemainingResults()) {
      results.push(r);
    }

    // Results should be in order
    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe('c1');
    expect(results[1]!.id).toBe('c2');
  });

  it('should return results in order even if later tool finishes first', async () => {
    const executor = new ToolExecutor();

    executor.register(createTool({
      name: 'slow',
      isConcurrencySafe: true,
      execute: vi.fn().mockImplementation(async () => {
        await delay(80);
        return 'slow_result';
      }),
    }));

    executor.register(createTool({
      name: 'fast',
      isConcurrencySafe: true,
      execute: vi.fn().mockImplementation(async () => {
        await delay(10);
        return 'fast_result';
      }),
    }));

    const streaming = new StreamingToolExecutor(executor);
    streaming.addTool('c1', 'slow', '{"input":"x"}');
    streaming.addTool('c2', 'fast', '{"input":"y"}');

    const results: Array<{ id: string; result: { content: string } }> = [];
    for await (const r of streaming.getRemainingResults()) {
      results.push(r);
    }

    // c1 (slow) must come before c2 (fast) — ordered by submission, not completion
    expect(results[0]!.id).toBe('c1');
    expect(results[0]!.result.content).toBe('slow_result');
    expect(results[1]!.id).toBe('c2');
    expect(results[1]!.result.content).toBe('fast_result');
  });

  it('should handle tool execution errors without breaking other tools', async () => {
    const executor = new ToolExecutor();

    executor.register(createTool({
      name: 'bad_tool',
      isConcurrencySafe: true,
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    }));

    executor.register(createTool({
      name: 'good_tool',
      isConcurrencySafe: true,
      execute: vi.fn().mockResolvedValue('ok'),
    }));

    const streaming = new StreamingToolExecutor(executor);
    streaming.addTool('c1', 'bad_tool', '{"input":"x"}');
    streaming.addTool('c2', 'good_tool', '{"input":"y"}');

    const results: Array<{ id: string; result: { content: string; isError?: boolean } }> = [];
    for await (const r of streaming.getRemainingResults()) {
      results.push(r);
    }

    expect(results).toHaveLength(2);
    expect(results[0]!.result.isError).toBe(true);
    expect(results[0]!.result.content).toContain('boom');
    expect(results[1]!.result.content).toBe('ok');
  });

  it('should respect AbortSignal', async () => {
    const executor = new ToolExecutor();
    executor.register(createTool({
      name: 'long_task',
      isConcurrencySafe: true,
      execute: vi.fn().mockImplementation(async (_args: unknown, signal: AbortSignal) => {
        if (signal.aborted) throw new Error('Aborted');
        await delay(200);
        if (signal.aborted) throw new Error('Aborted');
        return 'done';
      }),
    }));

    const controller = new AbortController();
    const streaming = new StreamingToolExecutor(executor, controller.signal);
    streaming.addTool('c1', 'long_task', '{"input":"x"}');

    // Abort after 20ms
    await delay(20);
    controller.abort();

    const results: Array<{ id: string; result: { content: string; isError?: boolean } }> = [];
    for await (const r of streaming.getRemainingResults()) {
      results.push(r);
    }

    expect(results).toHaveLength(1);
    expect(results[0]!.result.isError).toBe(true);
  });

  it('should execute unsafe tools serially (not in parallel)', async () => {
    const executor = new ToolExecutor();
    const order: string[] = [];

    executor.register(createTool({
      name: 'write_a',
      isConcurrencySafe: false,
      execute: vi.fn().mockImplementation(async () => {
        order.push('a:start');
        await delay(30);
        order.push('a:end');
        return 'a';
      }),
    }));

    executor.register(createTool({
      name: 'write_b',
      isConcurrencySafe: false,
      execute: vi.fn().mockImplementation(async () => {
        order.push('b:start');
        await delay(30);
        order.push('b:end');
        return 'b';
      }),
    }));

    const streaming = new StreamingToolExecutor(executor);
    streaming.addTool('c1', 'write_a', '{"input":"x"}');
    streaming.addTool('c2', 'write_b', '{"input":"y"}');

    const results: Array<{ id: string }> = [];
    for await (const r of streaming.getRemainingResults()) {
      results.push(r);
    }

    // Serial: a must finish before b starts
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
    expect(results).toHaveLength(2);
    expect(results[0]!.id).toBe('c1');
    expect(results[1]!.id).toBe('c2');
  });

  it('should wait for unsafe tool to finish before starting safe tools', async () => {
    const executor = new ToolExecutor();
    const order: string[] = [];

    executor.register(createTool({
      name: 'write',
      isConcurrencySafe: false,
      execute: vi.fn().mockImplementation(async () => {
        order.push('write:start');
        await delay(40);
        order.push('write:end');
        return 'w';
      }),
    }));

    executor.register(createTool({
      name: 'read',
      isConcurrencySafe: true,
      execute: vi.fn().mockImplementation(async () => {
        order.push('read:start');
        await delay(10);
        order.push('read:end');
        return 'r';
      }),
    }));

    const streaming = new StreamingToolExecutor(executor);
    streaming.addTool('c1', 'write', '{"input":"x"}');
    streaming.addTool('c2', 'read', '{"input":"y"}');

    const results: Array<{ id: string }> = [];
    for await (const r of streaming.getRemainingResults()) {
      results.push(r);
    }

    // write must finish before read starts
    expect(order.indexOf('write:end')).toBeLessThan(order.indexOf('read:start'));
    expect(results).toHaveLength(2);
  });

  it('should parse tool args exactly once per tool call (issue #3)', async () => {
    // Double JSON.parse wastes CPU and creates inconsistency when JSON is malformed.
    // parsedArgs computed in addTool() must be reused in executeTool() without re-parsing.
    const executor = new ToolExecutor();
    const receivedArgs: unknown[] = [];

    executor.register(createTool({
      name: 'probe',
      parameters: z.object({ input: z.string() }),
      isConcurrencySafe: (args: unknown) => {
        receivedArgs.push(args);
        return true;
      },
      execute: vi.fn().mockImplementation((args: unknown) => {
        receivedArgs.push(args);
        return Promise.resolve('ok');
      }),
    }));

    let parseCount = 0;
    const origParse = JSON.parse;
    vi.spyOn(JSON, 'parse').mockImplementation((text: string) => {
      parseCount++;
      return origParse(text);
    });

    const streaming = new StreamingToolExecutor(executor);
    streaming.addTool('c1', 'probe', '{"input":"hello"}');
    for await (const _ of streaming.getRemainingResults()) { /* drain */ }

    vi.restoreAllMocks();

    // Should parse args only once — not twice (addTool + executeTool)
    expect(parseCount).toBe(1);
    // Both isConcurrencySafe and execute should receive the same parsed object
    expect(receivedArgs).toHaveLength(2);
    expect(receivedArgs[0]).toEqual({ input: 'hello' });
    expect(receivedArgs[1]).toEqual({ input: 'hello' });
  });

  describe('non-null safety on result/duration (issue #27)', () => {
    function injectBrokenCompletedTool(streaming: StreamingToolExecutor): void {
      const tools = (streaming as unknown as { tools: Array<Record<string, unknown>> }).tools;
      tools.push({
        id: 'broken',
        name: 'test_tool',
        args: '{}',
        parsedArgs: {},
        isSafe: true,
        status: 'completed',
        // result and duration intentionally omitted to simulate invariant violation
        progressEvents: [],
      });
    }

    it('getCompletedResults should throw instead of silently yielding undefined result', () => {
      const executor = new ToolExecutor();
      const streaming = new StreamingToolExecutor(executor);
      injectBrokenCompletedTool(streaming);

      expect(() => [...streaming.getCompletedResults()]).toThrow(/result.*duration|not set/i);
    });

    it('getRemainingResults should throw instead of silently yielding undefined result', async () => {
      const executor = new ToolExecutor();
      const streaming = new StreamingToolExecutor(executor);
      injectBrokenCompletedTool(streaming);

      await expect(async () => {
        for await (const _ of streaming.getRemainingResults()) { /* drain */ }
      }).rejects.toThrow(/result.*duration|not set/i);
    });
  });

  it('getCompletedResults should skip tool with undefined result despite completed status (issue #27)', () => {
    const executor = new ToolExecutor();
    const streaming = new StreamingToolExecutor(executor);

    // Simulate invariant violation: status='completed' but result/duration not set
    (streaming as unknown as { tools: unknown[] }).tools.push({
      id: 'broken', name: 'test', args: '{}', parsedArgs: {},
      isSafe: false, status: 'completed', result: undefined, duration: undefined, progressEvents: [],
    });

    const results = [...streaming.getCompletedResults()];
    // Guard must skip this tool rather than yielding result: undefined
    expect(results).toHaveLength(0);
  });

  it('getCompletedResults should be non-blocking and yield only finished tools', async () => {
    const executor = new ToolExecutor();
    executor.register(createTool({
      name: 'slow',
      isConcurrencySafe: true,
      execute: vi.fn().mockImplementation(async () => {
        await delay(100);
        return 'slow';
      }),
    }));

    const streaming = new StreamingToolExecutor(executor);
    streaming.addTool('c1', 'slow', '{"input":"x"}');

    // Immediately check — tool hasn't finished yet
    const immediate = [...streaming.getCompletedResults()];
    expect(immediate).toHaveLength(0);

    // Wait for completion
    await delay(150);
    const completed = [...streaming.getCompletedResults()];
    expect(completed).toHaveLength(1);
    expect(completed[0]!.id).toBe('c1');
  });
});
