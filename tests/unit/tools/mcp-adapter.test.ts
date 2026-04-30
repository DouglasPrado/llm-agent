import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPAdapter, type MCPHealthStatus } from '../../../src/tools/mcp-adapter.js';
import type { ToolExecutor } from '../../../src/tools/tool-executor.js';

// Mock the MCP SDK module
const mockClient = {
  connect: vi.fn(),
  close: vi.fn(),
  listTools: vi.fn().mockResolvedValue({
    tools: [
      {
        name: 'read_file',
        description: 'Read a file from disk',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string', description: 'File path' } },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Write content to a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
      },
    ],
  }),
  callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'file content here' }] }),
};

const mockStdioTransport = vi.fn().mockImplementation(() => ({}));
const mockSSETransport = vi.fn().mockImplementation(() => ({}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => mockClient),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: mockStdioTransport,
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: mockSSETransport,
}));

function createMockExecutor(): ToolExecutor {
  return {
    register: vi.fn(),
    unregister: vi.fn().mockReturnValue(true),
    listTools: vi.fn().mockReturnValue([]),
    getToolDefinitions: vi.fn().mockReturnValue([]),
    execute: vi.fn().mockResolvedValue({ content: 'ok' }),
    executeParallel: vi.fn().mockResolvedValue([]),
  } as unknown as ToolExecutor;
}

describe('MCPAdapter', () => {
  let adapter: MCPAdapter;
  let executor: ToolExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = createMockExecutor();
    adapter = new MCPAdapter(executor);
  });

  afterEach(async () => {
    await adapter.disconnectAll();
  });

  describe('connect()', () => {
    it('should connect via stdio and register tools', async () => {
      const tools = await adapter.connect({
        name: 'filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
      });

      expect(tools).toHaveLength(2);
      expect(tools[0]!.name).toBe('mcp__filesystem__read_file');
      expect(tools[1]!.name).toBe('mcp__filesystem__write_file');
      expect(executor.register).toHaveBeenCalledTimes(2);
      expect(mockClient.connect).toHaveBeenCalledOnce();
    });

    it('should connect via SSE', async () => {
      const tools = await adapter.connect({
        name: 'remote-server',
        transport: 'sse',
        url: 'http://localhost:3001/sse',
      });

      expect(tools).toHaveLength(2);
      expect(mockClient.connect).toHaveBeenCalledOnce();
    });

    it('should pass headers to SSE transport', async () => {
      await adapter.connect({
        name: 'auth-server',
        transport: 'sse',
        url: 'http://localhost:3001/sse',
        headers: {
          'Authorization': 'Bearer my-token',
          'X-Custom': 'value',
        },
      });

      expect(mockSSETransport).toHaveBeenCalledWith(
        expect.any(URL),
        { requestInit: { headers: { 'Authorization': 'Bearer my-token', 'X-Custom': 'value' } } },
      );
    });

    it('should not pass requestInit when no headers', async () => {
      await adapter.connect({
        name: 'no-headers',
        transport: 'sse',
        url: 'http://localhost:3001/sse',
      });

      expect(mockSSETransport).toHaveBeenCalledWith(
        expect.any(URL),
        { requestInit: undefined },
      );
    });

    it('should namespace tool names with mcp__{server}__{tool}', async () => {
      const tools = await adapter.connect({
        name: 'my-server',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
      });

      expect(tools[0]!.name).toBe('mcp__my-server__read_file');
    });

    it('should reject duplicate server names', async () => {
      await adapter.connect({ name: 'dup', transport: 'stdio', command: 'node' });

      await expect(
        adapter.connect({ name: 'dup', transport: 'stdio', command: 'node' })
      ).rejects.toThrow('already connected');
    });
  });

  describe('disconnect()', () => {
    it('should disconnect and unregister tools', async () => {
      await adapter.connect({ name: 'test', transport: 'stdio', command: 'node' });
      await adapter.disconnect('test');

      expect(mockClient.close).toHaveBeenCalledOnce();
      expect(vi.mocked(executor.unregister)).toHaveBeenCalledWith('mcp__test__read_file');
      expect(vi.mocked(executor.unregister)).toHaveBeenCalledWith('mcp__test__write_file');
    });

    it('should throw for unknown server', async () => {
      await expect(adapter.disconnect('unknown')).rejects.toThrow('not found');
    });
  });

  describe('tool execution', () => {
    it('should execute tool calls via MCP protocol', async () => {
      const tools = await adapter.connect({
        name: 'fs',
        transport: 'stdio',
        command: 'node',
      });

      // Simulate executing the registered tool
      const readFile = tools[0]!;
      const result = await readFile.execute({ path: '/tmp/test.txt' }, new AbortController().signal);

      expect(mockClient.callTool).toHaveBeenCalledWith(
        { name: 'read_file', arguments: { path: '/tmp/test.txt' } },
        undefined,
        expect.objectContaining({}),
      );
      expect(result).toContain('file content here');
    });

    it('should timeout slow tool calls', async () => {
      // Simulate a tool that takes too long
      mockClient.callTool.mockImplementationOnce(() =>
        new Promise((resolve) => setTimeout(() => resolve({ content: [{ type: 'text', text: 'late' }] }), 5000))
      );

      const tools = await adapter.connect({
        name: 'slow-server',
        transport: 'stdio',
        command: 'node',
        timeout: 100, // 100ms timeout
      });

      const result = await tools[0]!.execute({ path: '/tmp/test.txt' }, new AbortController().signal);
      // Should return an error due to timeout, not hang forever
      expect(typeof result === 'object' && 'isError' in result && result.isError).toBe(true);
      expect(typeof result === 'object' && 'content' in result && (result.content as string)).toContain('error');
    }, 10_000);

    it('should handle tool execution errors with isolateErrors', async () => {
      mockClient.callTool.mockRejectedValueOnce(new Error('tool crashed'));

      const tools = await adapter.connect({
        name: 'fs',
        transport: 'stdio',
        command: 'node',
        isolateErrors: true,
      });

      const result = await tools[0]!.execute({ path: '/bad' }, new AbortController().signal);
      expect(typeof result === 'object' && 'isError' in result && result.isError).toBe(true);
    });
  });

  describe('getHealth()', () => {
    it('should report health status of all servers', async () => {
      await adapter.connect({ name: 'server-a', transport: 'stdio', command: 'node' });

      const health = adapter.getHealth();
      expect(health.servers).toHaveLength(1);
      expect(health.servers[0]!.name).toBe('server-a');
      expect(health.servers[0]!.status).toBe('connected');
      expect(health.servers[0]!.toolCount).toBe(2);
    });

    it('should return empty for no connections', () => {
      const health = adapter.getHealth();
      expect(health.servers).toHaveLength(0);
    });
  });

  describe('disconnectAll()', () => {
    it('should disconnect all servers', async () => {
      await adapter.connect({ name: 'a', transport: 'stdio', command: 'node' });
      await adapter.connect({ name: 'b', transport: 'stdio', command: 'node' });

      await adapter.disconnectAll();

      expect(adapter.getHealth().servers).toHaveLength(0);
      expect(mockClient.close).toHaveBeenCalledTimes(2);
    });
  });

  describe('isConnected()', () => {
    it('should return true for a connected server', async () => {
      await adapter.connect({ name: 'srv', transport: 'stdio', command: 'node' });
      expect(adapter.isConnected('srv')).toBe(true);
    });

    it('should return false for an unknown server', () => {
      expect(adapter.isConnected('nonexistent')).toBe(false);
    });

    it('should return false after disconnect', async () => {
      await adapter.connect({ name: 'srv', transport: 'stdio', command: 'node' });
      await adapter.disconnect('srv');
      expect(adapter.isConnected('srv')).toBe(false);
    });
  });

  describe('getConnections()', () => {
    it('should return connection info for all servers', async () => {
      await adapter.connect({ name: 'alpha', transport: 'stdio', command: 'node' });
      const conns = adapter.getConnections();

      expect(conns).toHaveLength(1);
      expect(conns[0]!.name).toBe('alpha');
      expect(conns[0]!.status).toBe('connected');
      expect(conns[0]!.toolCount).toBe(2);
    });

    it('should return empty array when no connections', () => {
      expect(adapter.getConnections()).toEqual([]);
    });
  });

  describe('getPrompts()', () => {
    it('should return empty map initially', () => {
      expect(adapter.getPrompts().size).toBe(0);
    });
  });

  describe('disconnect() edge cases', () => {
    it('should handle client.close() errors silently', async () => {
      mockClient.close.mockRejectedValueOnce(new Error('close failed'));
      await adapter.connect({ name: 'srv', transport: 'stdio', command: 'node' });

      await expect(adapter.disconnect('srv')).resolves.toBeUndefined();
      expect(adapter.getHealth().servers).toHaveLength(0);
    });

    it('should clear healthCheck timer on disconnect', async () => {
      await adapter.connect({
        name: 'monitored',
        transport: 'stdio',
        command: 'node',
        healthCheckInterval: 5000,
      });

      await adapter.disconnect('monitored');
      expect(adapter.isConnected('monitored')).toBe(false);
    });
  });

  describe('tool execution — content types', () => {
    it('should handle isError response from MCP tool', async () => {
      mockClient.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Something went wrong' }],
        isError: true,
      });

      const tools = await adapter.connect({ name: 'err-srv', transport: 'stdio', command: 'node' });
      const result = await tools[0]!.execute({}, new AbortController().signal);

      expect(typeof result === 'object' && 'isError' in result && result.isError).toBe(true);
      expect(typeof result === 'object' && 'content' in result && result.content).toContain('Something went wrong');
    });

    it('should handle empty content with isError', async () => {
      mockClient.callTool.mockResolvedValueOnce({ content: [], isError: true });

      const tools = await adapter.connect({ name: 'empty-err', transport: 'stdio', command: 'node' });
      const result = await tools[0]!.execute({}, new AbortController().signal);

      expect(typeof result === 'object' && 'isError' in result && result.isError).toBe(true);
      expect(typeof result === 'object' && 'content' in result && result.content).toBe('MCP tool returned an error');
    });

    it('should return fallback message for empty successful content', async () => {
      mockClient.callTool.mockResolvedValueOnce({ content: [] });

      const tools = await adapter.connect({ name: 'no-out', transport: 'stdio', command: 'node' });
      const result = await tools[0]!.execute({}, new AbortController().signal);

      expect(result).toBe('Tool completed with no text output');
    });

    it('should handle image content type', async () => {
      mockClient.callTool.mockResolvedValueOnce({
        content: [{ type: 'image', mimeType: 'image/png', data: 'a'.repeat(4096) }],
      });

      const tools = await adapter.connect({ name: 'img-srv', transport: 'stdio', command: 'node' });
      const result = await tools[0]!.execute({}, new AbortController().signal);

      expect(result).toContain('[Image: image/png');
      expect(result).toContain('KB]');
    });

    it('should handle image with no mimeType', async () => {
      mockClient.callTool.mockResolvedValueOnce({
        content: [{ type: 'image', data: 'abc' }],
      });

      const tools = await adapter.connect({ name: 'img2', transport: 'stdio', command: 'node' });
      const result = await tools[0]!.execute({}, new AbortController().signal);

      expect(result).toContain('[Image: unknown');
    });

    it('should handle resource content type with text', async () => {
      mockClient.callTool.mockResolvedValueOnce({
        content: [{ type: 'resource', text: 'resource data here' }],
      });

      const tools = await adapter.connect({ name: 'res-srv', transport: 'stdio', command: 'node' });
      const result = await tools[0]!.execute({}, new AbortController().signal);

      expect(result).toBe('resource data here');
    });

    it('should handle resource content type without text', async () => {
      mockClient.callTool.mockResolvedValueOnce({
        content: [{ type: 'resource', uri: 'file:///tmp/data.bin' }],
      });

      const tools = await adapter.connect({ name: 'res2', transport: 'stdio', command: 'node' });
      const result = await tools[0]!.execute({}, new AbortController().signal);

      expect(result).toBe('[Resource: file:///tmp/data.bin]');
    });

    it('should handle unknown content type', async () => {
      mockClient.callTool.mockResolvedValueOnce({
        content: [{ type: 'audio' }],
      });

      const tools = await adapter.connect({ name: 'unk-srv', transport: 'stdio', command: 'node' });
      const result = await tools[0]!.execute({}, new AbortController().signal);

      expect(result).toBe('[audio]');
    });

    it('should join multiple content parts', async () => {
      mockClient.callTool.mockResolvedValueOnce({
        content: [
          { type: 'text', text: 'line 1' },
          { type: 'text', text: 'line 2' },
        ],
      });

      const tools = await adapter.connect({ name: 'multi', transport: 'stdio', command: 'node' });
      const result = await tools[0]!.execute({}, new AbortController().signal);

      expect(result).toBe('line 1\nline 2');
    });
  });

  describe('tool execution — isolateErrors=false', () => {
    it('should throw when isolateErrors is false', async () => {
      mockClient.callTool.mockRejectedValueOnce(new Error('boom'));

      const tools = await adapter.connect({
        name: 'throw-srv',
        transport: 'stdio',
        command: 'node',
        isolateErrors: false,
      });

      await expect(tools[0]!.execute({}, new AbortController().signal)).rejects.toThrow('boom');
    });
  });

  describe('tool annotations', () => {
    it('should map readOnlyHint and destructiveHint to tool flags', async () => {
      mockClient.listTools.mockResolvedValueOnce({
        tools: [
          {
            name: 'safe_read',
            description: 'Read-only op',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true, destructiveHint: false },
          },
          {
            name: 'danger_write',
            description: 'Destructive op',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: false, destructiveHint: true },
          },
        ],
      });

      const tools = await adapter.connect({ name: 'annotated', transport: 'stdio', command: 'node' });

      expect(tools[0]!.isReadOnly).toBe(true);
      expect(tools[0]!.isDestructive).toBe(false);
      expect(tools[0]!.isConcurrencySafe).toBe(true);

      expect(tools[1]!.isReadOnly).toBe(false);
      expect(tools[1]!.isDestructive).toBe(true);
      expect(tools[1]!.isConcurrencySafe).toBe(false);
    });

    it('should default annotations when not provided', async () => {
      mockClient.listTools.mockResolvedValueOnce({
        tools: [{ name: 'plain', inputSchema: { type: 'object', properties: {} } }],
      });

      const tools = await adapter.connect({ name: 'no-annot', transport: 'stdio', command: 'node' });

      expect(tools[0]!.isReadOnly).toBe(false);
      expect(tools[0]!.isDestructive).toBe(false);
      expect(tools[0]!.description).toContain('MCP tool: plain');
    });
  });

  describe('listResources()', () => {
    it('should return resources from connected server', async () => {
      const mockResources = [
        { uri: 'file:///a.txt', name: 'a.txt', mimeType: 'text/plain' },
        { uri: 'file:///b.md', name: 'b.md' },
      ];
      (mockClient as Record<string, unknown>).listResources = vi.fn().mockResolvedValue({ resources: mockResources });

      await adapter.connect({ name: 'res-srv', transport: 'stdio', command: 'node' });
      const resources = await adapter.listResources('res-srv');

      expect(resources).toHaveLength(2);
      expect(resources[0]!.serverName).toBe('res-srv');
      expect(resources[0]!.uri).toBe('file:///a.txt');

      delete (mockClient as Record<string, unknown>).listResources;
    });

    it('should return empty for unknown server', async () => {
      const result = await adapter.listResources('unknown');
      expect(result).toEqual([]);
    });

    it('should return empty when server has no listResources', async () => {
      await adapter.connect({ name: 'no-res', transport: 'stdio', command: 'node' });
      const result = await adapter.listResources('no-res');
      expect(result).toEqual([]);
    });

    it('should return empty on listResources error', async () => {
      (mockClient as Record<string, unknown>).listResources = vi.fn().mockRejectedValue(new Error('fail'));

      await adapter.connect({ name: 'err-res', transport: 'stdio', command: 'node' });
      const result = await adapter.listResources('err-res');
      expect(result).toEqual([]);

      delete (mockClient as Record<string, unknown>).listResources;
    });
  });

  describe('readResource()', () => {
    it('should read and join resource contents', async () => {
      (mockClient as Record<string, unknown>).readResource = vi.fn().mockResolvedValue({
        contents: [
          { text: 'line 1', uri: 'file:///a.txt' },
          { text: 'line 2', uri: 'file:///a.txt' },
        ],
      });

      await adapter.connect({ name: 'read-srv', transport: 'stdio', command: 'node' });
      const result = await adapter.readResource('read-srv', 'file:///a.txt');

      expect(result).toBe('line 1\nline 2');
      delete (mockClient as Record<string, unknown>).readResource;
    });

    it('should handle binary content (no text)', async () => {
      (mockClient as Record<string, unknown>).readResource = vi.fn().mockResolvedValue({
        contents: [{ uri: 'file:///image.png' }],
      });

      await adapter.connect({ name: 'bin-srv', transport: 'stdio', command: 'node' });
      const result = await adapter.readResource('bin-srv', 'file:///image.png');

      expect(result).toBe('[Binary: file:///image.png]');
      delete (mockClient as Record<string, unknown>).readResource;
    });

    it('should throw for disconnected server', async () => {
      await expect(adapter.readResource('gone', 'file:///x')).rejects.toThrow('not connected');
    });

    it('should throw when server does not support resources', async () => {
      await adapter.connect({ name: 'no-sup', transport: 'stdio', command: 'node' });
      await expect(adapter.readResource('no-sup', 'file:///x')).rejects.toThrow('does not support resources');
    });
  });

  describe('getPrompt()', () => {
    it('should fetch prompt and join messages', async () => {
      (mockClient as Record<string, unknown>).getPrompt = vi.fn().mockResolvedValue({
        messages: [
          { role: 'system', content: { type: 'text', text: 'You are helpful' } },
          { role: 'user', content: 'Hello' },
        ],
      });

      await adapter.connect({ name: 'prompt-srv', transport: 'stdio', command: 'node' });
      const result = await adapter.getPrompt('prompt-srv', 'my-prompt');

      expect(result).toBe('You are helpful\nHello');
      delete (mockClient as Record<string, unknown>).getPrompt;
    });

    it('should parse key=value args', async () => {
      const getPromptFn = vi.fn().mockResolvedValue({
        messages: [{ role: 'user', content: 'ok' }],
      });
      (mockClient as Record<string, unknown>).getPrompt = getPromptFn;

      await adapter.connect({ name: 'args-srv', transport: 'stdio', command: 'node' });
      await adapter.getPrompt('args-srv', 'my-prompt', 'name=John lang=en');

      expect(getPromptFn).toHaveBeenCalledWith({
        name: 'my-prompt',
        arguments: { name: 'John', lang: 'en' },
      });
      delete (mockClient as Record<string, unknown>).getPrompt;
    });

    it('should handle args with = in value', async () => {
      const getPromptFn = vi.fn().mockResolvedValue({
        messages: [{ role: 'user', content: 'ok' }],
      });
      (mockClient as Record<string, unknown>).getPrompt = getPromptFn;

      await adapter.connect({ name: 'eq-srv', transport: 'stdio', command: 'node' });
      await adapter.getPrompt('eq-srv', 'p', 'query=a=b');

      expect(getPromptFn).toHaveBeenCalledWith({
        name: 'p',
        arguments: { query: 'a=b' },
      });
      delete (mockClient as Record<string, unknown>).getPrompt;
    });

    it('should throw for disconnected server', async () => {
      await expect(adapter.getPrompt('gone', 'p')).rejects.toThrow('not connected');
    });

    it('should throw when server does not support prompts', async () => {
      await adapter.connect({ name: 'no-prompt', transport: 'stdio', command: 'node' });
      await expect(adapter.getPrompt('no-prompt', 'p')).rejects.toThrow('does not support prompts');
    });

    it('should handle message with content object missing text', async () => {
      (mockClient as Record<string, unknown>).getPrompt = vi.fn().mockResolvedValue({
        messages: [{ role: 'system', content: { type: 'image' } }],
      });

      await adapter.connect({ name: 'notext', transport: 'stdio', command: 'node' });
      const result = await adapter.getPrompt('notext', 'p');
      expect(result).toBe('');

      delete (mockClient as Record<string, unknown>).getPrompt;
    });
  });

  describe('connectWithFallback — auto transport', () => {
    const mockStreamableTransport = vi.fn().mockImplementation(() => ({}));

    beforeEach(() => {
      vi.doMock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
        StreamableHTTPClientTransport: mockStreamableTransport,
      }));
    });

    it('should try StreamableHTTP first on auto transport', async () => {
      const tools = await adapter.connect({
        name: 'auto-srv',
        transport: 'auto',
        url: 'http://localhost:3000/mcp',
      });

      expect(tools).toHaveLength(2);
      expect(mockClient.connect).toHaveBeenCalled();
    });

    it('should fall back to SSE when StreamableHTTP fails', async () => {
      // Make first connect (StreamableHTTP) fail, second (SSE) succeed
      let callCount = 0;
      mockClient.connect.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('StreamableHTTP not supported');
      });

      const tools = await adapter.connect({
        name: 'fallback-srv',
        transport: 'auto',
        url: 'http://localhost:3000/mcp',
      });

      expect(tools).toHaveLength(2);
      expect(mockClient.connect).toHaveBeenCalledTimes(2);
    });
  });

  describe('http transport', () => {
    it('should connect via http transport', async () => {
      vi.doMock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
        StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({})),
      }));

      const tools = await adapter.connect({
        name: 'http-srv',
        transport: 'http',
        url: 'http://localhost:3000/mcp',
      });

      expect(tools).toHaveLength(2);
    });
  });

  describe('Zod validation in readResource / getPrompt / listResources (issue #28)', () => {
    it('readResource should throw clear error when server returns invalid shape', async () => {
      (mockClient as Record<string, unknown>).readResource = vi.fn().mockResolvedValue({
        notContents: 'unexpected',  // missing required `contents` array
      });

      await adapter.connect({ name: 'bad-read', transport: 'stdio', command: 'node' });

      await expect(adapter.readResource('bad-read', 'file:///x.txt'))
        .rejects.toThrow(/invalid.*shape|invalid resource/i);

      delete (mockClient as Record<string, unknown>).readResource;
    });

    it('getPrompt should throw clear error when server returns invalid shape', async () => {
      (mockClient as Record<string, unknown>).getPrompt = vi.fn().mockResolvedValue({
        notMessages: 'unexpected',  // missing required `messages` array
      });

      await adapter.connect({ name: 'bad-prompt', transport: 'stdio', command: 'node' });

      await expect(adapter.getPrompt('bad-prompt', 'p'))
        .rejects.toThrow(/invalid.*shape|invalid prompt/i);

      delete (mockClient as Record<string, unknown>).getPrompt;
    });

    it('listResources should return empty when server returns invalid shape', async () => {
      (mockClient as Record<string, unknown>).listResources = vi.fn().mockResolvedValue({
        notResources: 'unexpected',  // missing required `resources` array
      });

      await adapter.connect({ name: 'bad-list', transport: 'stdio', command: 'node' });
      const result = await adapter.listResources('bad-list');
      expect(result).toEqual([]);  // graceful fallback for list operation

      delete (mockClient as Record<string, unknown>).listResources;
  describe('healthCheck race condition (issue #24)', () => {
    it('concurrent healthCheck fires should not start multiple reconnect attempts', async () => {
      // Regression test: if healthCheck fires while a reconnect is in progress,
      // only ONE reconnect process should be active (status window elimination).
      vi.useFakeTimers();

      let reconnectConnectCalls = 0;
      mockClient.listTools
        .mockResolvedValueOnce({ tools: [] }) // initial connect
        .mockRejectedValue(new Error('conn lost')); // all health checks fail
      mockClient.connect
        .mockResolvedValueOnce(undefined) // initial connect succeeds
        .mockImplementation(async () => {
          reconnectConnectCalls++;
        });

      await adapter.connect({
        name: 'hc-race',
        transport: 'stdio',
        command: 'node',
        healthCheckInterval: 100,
        maxRetries: 1, // one reconnect attempt per reconnect cycle
      });

      // Advance 200ms: healthCheck fires at 100ms and 200ms.
      // Both fail → buggy code starts TWO reconnect processes;
      // fixed code starts ONE (second healthCheck returns early).
      await vi.advanceTimersByTimeAsync(200);

      // Advance past reconnect delays: first attempt delay=1000ms (starts at 100ms, fires at 1100ms);
      // a second reconnect (if started at 200ms) fires at 1200ms.
      await vi.advanceTimersByTimeAsync(2000);

      // Fixed code: exactly 1 reconnect connect call (one process, one attempt).
      // Buggy code: 2 reconnect connect calls (two concurrent processes, one attempt each).
      expect(reconnectConnectCalls).toBe(1);

      vi.useRealTimers();
      await adapter.disconnectAll();
    });

    it('healthCheck while reconnecting should skip (status stays reconnecting)', async () => {
      // After the first healthCheck failure, status should go to 'reconnecting'.
      // A subsequent healthCheck must NOT overwrite it back to 'error' nor spawn a second reconnect.
      vi.useFakeTimers();

      mockClient.listTools
        .mockResolvedValueOnce({ tools: [] })
        .mockRejectedValue(new Error('conn lost'));
      mockClient.connect
        .mockResolvedValueOnce(undefined) // initial
        .mockImplementation(async () => { /* reconnect — completes */ });

      await adapter.connect({
        name: 'hc-status',
        transport: 'stdio',
        command: 'node',
        healthCheckInterval: 100,
        maxRetries: 1,
      });

      // Fire first health check — should transition to 'reconnecting'
      await vi.advanceTimersByTimeAsync(100);

      // Fire second health check while first reconnect's delay is pending
      // Fixed code: guard at top of healthCheck skips; status stays 'reconnecting'.
      // Buggy code: listTools fails → status set to 'error' (briefly) then reconnecting again.
      await vi.advanceTimersByTimeAsync(100);

      // After the second fire, status must still be 'reconnecting' (not 'error')
      const status = adapter.getHealth().servers.find(s => s.name === 'hc-status')?.status;
      expect(status).toBe('reconnecting');

      vi.useRealTimers();
      await adapter.disconnectAll();
    });
  });

  describe('namespace collision (issue #2)', () => {
    it('should sanitize __ in serverName to prevent namespace collision', async () => {
      mockClient.listTools.mockResolvedValueOnce({
        tools: [{ name: 'baz', description: 'tool', inputSchema: { type: 'object', properties: {} } }],
      });

      // server "foo__bar" + tool "baz" must NOT produce same name as server "foo" + tool "bar__baz"
      const tools = await adapter.connect({
        name: 'foo__bar',
        transport: 'stdio',
        command: 'node',
        args: ['s.js'],
      });

      // After sanitization: mcp__foo_bar__baz (single underscore replaces __)
      expect(tools[0]!.name).toBe('mcp__foo_bar__baz');
    });

    it('should sanitize __ in toolName to prevent namespace collision', async () => {
      mockClient.listTools.mockResolvedValueOnce({
        tools: [{ name: 'bar__baz', description: 'tool', inputSchema: { type: 'object', properties: {} } }],
      });

      const tools = await adapter.connect({
        name: 'foo',
        transport: 'stdio',
        command: 'node',
        args: ['s.js'],
      });

      // After sanitization: mcp__foo__bar_baz (__ in tool name collapsed to _)
      expect(tools[0]!.name).toBe('mcp__foo__bar_baz');
    });
  });
});
