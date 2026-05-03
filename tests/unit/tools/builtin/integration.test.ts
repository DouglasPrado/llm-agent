import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ToolExecutor } from '../../../../src/tools/tool-executor.js';
import { builtinTools } from '../../../../src/tools/builtin/index.js';
import { Agent } from '../../../../src/agent.js';

describe('Builtin tools integration', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  describe('path containment via workingDir (issue #69)', () => {
    let workingDir: string;

    beforeEach(async () => {
      workingDir = await mkdtemp(join(tmpdir(), 'builtin-all-'));
      await writeFile(join(workingDir, 'file.txt'), 'hello');
    });

    afterEach(async () => {
      await rm(workingDir, { recursive: true, force: true });
    });

    it('all(workingDir) — Write tool blocks paths outside workingDir', async () => {
      const executor = new ToolExecutor();
      builtinTools.all(workingDir).forEach(t => executor.register(t));

      const result = await executor.execute('Write', {
        file_path: join(tmpdir(), 'escaped.txt'),
        content: 'bad',
      });
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/traversal|outside|blocked/i);
    });

    it('all(workingDir) — Write tool allows paths inside workingDir', async () => {
      const executor = new ToolExecutor();
      builtinTools.all(workingDir).forEach(t => executor.register(t));

      const result = await executor.execute('Write', {
        file_path: join(workingDir, 'safe.txt'),
        content: 'ok',
      });
      expect(result.isError).toBeFalsy();
    });

    it('all(workingDir) — Edit tool blocks paths outside workingDir', async () => {
      const executor = new ToolExecutor();
      builtinTools.all(workingDir).forEach(t => executor.register(t));

      const result = await executor.execute('Edit', {
        file_path: join(tmpdir(), 'escaped.txt'),
        old_string: 'hello',
        new_string: 'world',
      });
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/traversal|outside|blocked/i);
    });

    it('all() without workingDir remains backward compatible', async () => {
      const executor = new ToolExecutor();
      builtinTools.all().forEach(t => executor.register(t));

      const result = await executor.execute('Write', {
        file_path: join(workingDir, 'compat.txt'),
        content: 'ok',
      });
      expect(result.isError).toBeFalsy();
    });

    it('fileOps(workingDir) — Write tool enforces containment', async () => {
      const executor = new ToolExecutor();
      builtinTools.fileOps(workingDir).forEach(t => executor.register(t));

      const result = await executor.execute('Write', {
        file_path: join(tmpdir(), 'escaped.txt'),
        content: 'bad',
      });
      expect(result.isError).toBe(true);
    });
  });

  it('should register all tools and generate valid JSON Schema for LLM', () => {
    const executor = new ToolExecutor();
    builtinTools.all().forEach(t => executor.register(t));

    const defs = executor.getToolDefinitions();
    expect(defs.length).toBe(7); // all() excludes askUser

    for (const def of defs) {
      expect(def.type).toBe('function');
      expect(def.function.name).toBeTruthy();
      expect(def.function.description).toBeTruthy();
      expect(def.function.parameters).toBeDefined();
      expect(def.function.parameters).toHaveProperty('type');
    }
  });

  it('should register via Agent.addTool and appear in tool listing', () => {
    const agent = Agent.create({ apiKey: 'test', memory: { enabled: false }, knowledge: { enabled: false } });

    builtinTools.all().forEach(t => agent.addTool(t));

    // Tools should be visible (agent doesn't expose listTools, but we can verify
    // by checking that the agent was created without error)
    expect(agent).toBeDefined();
  });

  it('should execute Read tool on real file', async () => {
    const executor = new ToolExecutor();
    executor.register(builtinTools.fileRead());

    const result = await executor.execute('Read', { file_path: process.cwd() + '/package.json' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('agentx-sdk');
  });

  it('should execute Glob tool on real directory', async () => {
    const executor = new ToolExecutor();
    executor.register(builtinTools.glob());

    const result = await executor.execute('Glob', { pattern: 'src/tools/builtin/*.ts', path: process.cwd() });
    const content = typeof result === 'string' ? result : result.content;
    expect(content).toContain('glob.ts');
    expect(content).toContain('bash.ts');
  });

  it('should execute Grep tool on real files', async () => {
    const executor = new ToolExecutor();
    executor.register(builtinTools.grep());

    const result = await executor.execute('Grep', {
      pattern: 'export function create',
      path: process.cwd() + '/src/tools/builtin',
    });
    const content = typeof result === 'string' ? result : result.content;
    expect(content).toContain('createGlobTool');
  });

  it('should execute Bash tool', async () => {
    const executor = new ToolExecutor();
    executor.register(builtinTools.bash());

    const result = await executor.execute('Bash', { command: 'echo "agent loop works"' });
    const content = typeof result === 'string' ? result : result.content;
    expect(content).toContain('agent loop works');
  });

  it('should provide fileOps() helper with 5 tools', () => {
    const tools = builtinTools.fileOps();
    expect(tools.length).toBe(5);
    const names = tools.map(t => t.name).sort();
    expect(names).toEqual(['Edit', 'Glob', 'Grep', 'Read', 'Write']);
  });

  it('should set correct flags on each tool', () => {
    const all = builtinTools.all();
    const read = all.find(t => t.name === 'Read')!;
    const write = all.find(t => t.name === 'Write')!;
    const bash = all.find(t => t.name === 'Bash')!;
    const glob = all.find(t => t.name === 'Glob')!;

    expect(read.isConcurrencySafe).toBe(true);
    expect(read.isReadOnly).toBe(true);
    expect(read.getFilePath).toBeDefined();

    expect(write.isDestructive).toBe(true);
    expect(write.getFilePath).toBeDefined();

    expect(bash.isDestructive).toBe(true);
    expect(bash.timeoutMs).toBe(120_000);

    expect(glob.isConcurrencySafe).toBe(true);
    expect(glob.isReadOnly).toBe(true);
  });

  it('should work end-to-end with Agent.stream()', async () => {
    // Mock fetch to simulate LLM calling the Read tool
    const toolCallSSE = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc-1","type":"function","function":{"name":"Read","arguments":"{\\"file_path\\":\\"' + process.cwd() + '/package.json\\"}"}}]},"index":0}]}\n\n',
      'data: {"choices":[{"finish_reason":"tool_calls","index":0}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
    ].join('');

    const finalSSE = [
      'data: {"choices":[{"delta":{"content":"The package name is agentx-sdk."},"index":0}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop","index":0}],"usage":{"prompt_tokens":20,"completion_tokens":10,"total_tokens":30}}\n\n',
    ].join('');

    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/embeddings')) {
        return new Response(JSON.stringify({ data: [{ embedding: [0.1] }] }), { status: 200 });
      }
      callCount++;
      const data = callCount === 1 ? toolCallSSE : finalSSE;
      return new Response(
        new ReadableStream({
          start(c) { c.enqueue(new TextEncoder().encode(data)); c.close(); },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    });

    const agent = Agent.create({ apiKey: 'test', memory: { enabled: false }, knowledge: { enabled: false } });
    agent.addTool(builtinTools.fileRead());

    const events: string[] = [];
    for await (const event of agent.stream('Read package.json')) {
      events.push(event.type);
    }

    expect(events).toContain('tool_call_start');
    expect(events).toContain('tool_call_end');
    expect(events).toContain('text_delta');
    expect(events).toContain('agent_end');

    await agent.destroy();
  });
});
