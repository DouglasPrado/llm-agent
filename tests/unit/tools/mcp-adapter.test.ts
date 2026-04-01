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
});
