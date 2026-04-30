import { z } from 'zod';
import type { AgentTool } from '../contracts/entities/agent-tool.js';
import type { AgentToolResult } from '../contracts/entities/tool-call.js';
import type { MCPConnectionConfig } from '../config/config.js';
import type { ToolExecutor } from './tool-executor.js';
import { jsonSchemaToZod } from './json-schema-to-zod.js';

/** Validated shape of listResources server response. */
const ListResourcesResultSchema = z.object({
  resources: z.array(z.object({
    uri: z.string(),
    name: z.string(),
    mimeType: z.string().optional(),
    description: z.string().optional(),
  }).passthrough()),
});

/** Validated shape of readResource server response. */
const ReadResourceResultSchema = z.object({
  contents: z.array(z.object({
    text: z.string().optional(),
    uri: z.string(),
  }).passthrough()),
});

/** Validated shape of getPrompt server response. */
const GetPromptResultSchema = z.object({
  messages: z.array(z.object({
    role: z.string(),
    content: z.union([
      z.string(),
      z.object({ type: z.string(), text: z.string().optional() }).passthrough(),
    ]),
  })),
});

/** Shape of the content array returned from MCP server tool calls. */
const MCPToolContentSchema = z.array(
  z.object({
    type: z.string(),
    text: z.string().optional(),
    data: z.string().optional(),
    mimeType: z.string().optional(),
    uri: z.string().optional(),
  }).passthrough(),
);

export interface MCPHealthStatus {
  servers: Array<{
    name: string;
    status: 'connected' | 'disconnected' | 'error' | 'reconnecting';
    lastError?: string;
    toolCount: number;
    uptime: number;
  }>;
}

interface MCPConnection {
  name: string;
  config: MCPConnectionConfig;
  client: MCPClient;
  transport: unknown;
  toolNames: string[];
  connectedAt: number;
  lastError?: string;
  status: 'connected' | 'disconnected' | 'error' | 'reconnecting';
  healthTimer?: ReturnType<typeof setInterval>;
  instructions?: string;
}

// Minimal MCP SDK types (resolved via dynamic import)
interface MCPClient {
  connect(transport: unknown): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<{ tools: MCPToolDef[] }>;
  callTool(params: { name: string; arguments: unknown }, resultSchema?: unknown, options?: { signal?: AbortSignal }): Promise<MCPToolResult>;
}

interface MCPToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
    title?: string;
  };
}

interface MCPToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

/**
 * Bridges MCP servers to AgentTool instances.
 * Uses dynamic import for @modelcontextprotocol/sdk.
 */
export interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
  serverName: string;
}

export interface MCPPromptInfo {
  serverName: string;
  promptName: string;
  description?: string;
}

export interface MCPConnectionInfo {
  name: string;
  status: string;
  instructions?: string;
  toolCount: number;
}

export class MCPAdapter {
  private readonly executor: ToolExecutor;
  private readonly connections = new Map<string, MCPConnection>();
  /** MCP prompts discovered from servers */
  private readonly mcpPrompts = new Map<string, MCPPromptInfo>();

  constructor(executor: ToolExecutor) {
    this.executor = executor;
  }

  /**
   * Connect to an MCP server and register its tools.
   * For URL-based transports (sse/http), auto-detects the correct transport
   * by trying StreamableHTTP first, then falling back to SSE.
   */
  async connect(config: MCPConnectionConfig): Promise<AgentTool[]> {
    if (this.connections.has(config.name)) {
      throw new Error(`MCP server "${config.name}" already connected`);
    }

    const { Client } = await loadSDK();

    const { client, transport } = await this.connectWithFallback(Client, config);

    // List tools from server
    const { tools: mcpTools } = await client.listTools();

    // Convert MCP tools to AgentTools
    const agentTools = mcpTools.map(mcpTool =>
      this.convertTool(config.name, mcpTool, client, config)
    );

    // Register tools in executor
    for (const tool of agentTools) {
      this.executor.register(tool);
    }

    // Track connection
    const connection: MCPConnection = {
      name: config.name,
      config,
      client,
      transport,
      toolNames: agentTools.map(t => t.name),
      connectedAt: Date.now(),
      status: 'connected',
    };

    // Health check timer
    if (config.healthCheckInterval && config.healthCheckInterval > 0) {
      connection.healthTimer = setInterval(
        () => void this.healthCheck(config.name),
        config.healthCheckInterval,
      );
    }

    this.connections.set(config.name, connection);
    return agentTools;
  }

  /**
   * Disconnect a specific server and unregister its tools.
   */
  async disconnect(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) throw new Error(`MCP server "${name}" not found`);

    // Clear health check
    if (conn.healthTimer) clearInterval(conn.healthTimer);

    // Unregister tools
    for (const toolName of conn.toolNames) {
      this.executor.unregister(toolName);
    }

    // Close connection
    try {
      await conn.client.close();
    } catch {
      // Ignore close errors
    }

    this.connections.delete(name);
  }

  /**
   * Disconnect all servers.
   */
  async disconnectAll(): Promise<void> {
    const names = [...this.connections.keys()];
    for (const name of names) {
      await this.disconnect(name);
    }
  }

  /**
   * Get health status of all connected servers.
   */
  getHealth(): MCPHealthStatus {
    return {
      servers: [...this.connections.values()].map(conn => ({
        name: conn.name,
        status: conn.status,
        lastError: conn.lastError,
        toolCount: conn.toolNames.length,
        uptime: Date.now() - conn.connectedAt,
      })),
    };
  }

  isConnected(name: string): boolean {
    return this.connections.get(name)?.status === 'connected';
  }

  /** Get connection info for all servers (for context injection). */
  getConnections(): MCPConnectionInfo[] {
    return [...this.connections.values()].map(conn => ({
      name: conn.name,
      status: conn.status,
      instructions: conn.instructions,
      toolCount: conn.toolNames.length,
    }));
  }

  /** Get all discovered MCP prompts. */
  getPrompts(): Map<string, MCPPromptInfo> {
    return this.mcpPrompts;
  }

  /** List resources from a connected server. */
  async listResources(serverName: string): Promise<MCPResource[]> {
    const conn = this.connections.get(serverName);
    if (!conn || conn.status !== 'connected') return [];

    try {
      const raw = await (conn.client as unknown as {
        listResources?: () => Promise<unknown>;
      }).listResources?.();
      if (!raw) return [];
      const parsed = ListResourcesResultSchema.parse(raw);
      return parsed.resources.map(r => ({ ...r, serverName }));
    } catch {
      return [];
    }
  }

  /** Read a specific resource from a server. */
  async readResource(serverName: string, uri: string): Promise<string> {
    const conn = this.connections.get(serverName);
    if (!conn || conn.status !== 'connected') {
      throw new Error(`MCP server "${serverName}" not connected`);
    }

    const raw = await (conn.client as unknown as {
      readResource?: (params: { uri: string }) => Promise<unknown>;
    }).readResource?.({ uri });
    if (!raw) throw new Error('Server does not support resources');

    const parsed = ReadResourceResultSchema.parse(raw);
    return parsed.contents.map(c => c.text ?? `[Binary: ${c.uri}]`).join('\n');
  }

  /** Fetch and return a prompt from a server (for skill getPrompt). */
  async getPrompt(serverName: string, promptName: string, args?: string): Promise<string> {
    const conn = this.connections.get(serverName);
    if (!conn || conn.status !== 'connected') {
      throw new Error(`MCP server "${serverName}" not connected`);
    }

    const parsedArgs: Record<string, string> = {};
    if (args) {
      for (const part of args.split(/\s+/)) {
        const [k, ...v] = part.split('=');
        if (k && v.length > 0) parsedArgs[k] = v.join('=');
      }
    }

    const raw = await (conn.client as unknown as {
      getPrompt?: (params: { name: string; arguments?: Record<string, string> }) => Promise<unknown>;
    }).getPrompt?.({ name: promptName, arguments: parsedArgs });

    if (!raw) throw new Error('Server does not support prompts');

    const parsed = GetPromptResultSchema.parse(raw);
    return parsed.messages.map(m => {
      const content = typeof m.content === 'string' ? m.content : m.content.text ?? '';
      return content;
    }).join('\n');
  }

  private convertTool(serverName: string, mcpTool: MCPToolDef, client: MCPClient, config: MCPConnectionConfig): AgentTool {
    const safeServerName = serverName.replace(/__/g, '_');
    const safeToolName = mcpTool.name.replace(/__/g, '_');
    const namespacedName = `mcp__${safeServerName}__${safeToolName}`;
    const parameters = jsonSchemaToZod(mcpTool.inputSchema as Record<string, unknown> | undefined);
    const isolateErrors = config.isolateErrors ?? true;
    const timeout = config.timeout ?? 30_000;

    // Map MCP annotations to AgentTool flags
    const annotations = mcpTool.annotations ?? {};
    const isReadOnly = annotations.readOnlyHint ?? false;
    const isDestructive = annotations.destructiveHint ?? false;

    return {
      name: namespacedName,
      description: mcpTool.description?.slice(0, 2048) ?? `MCP tool: ${mcpTool.name}`,
      parameters,
      isReadOnly,
      isDestructive,
      isConcurrencySafe: isReadOnly, // read-only tools are safe for parallel execution
      execute: async (args: unknown, signal: AbortSignal): Promise<string | AgentToolResult> => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);
          signal.addEventListener('abort', () => controller.abort(), { once: true });

          try {
            const timeoutPromise = new Promise<never>((_, reject) => {
              controller.signal.addEventListener('abort', () => reject(new Error(`MCP tool "${mcpTool.name}" timed out after ${timeout}ms`)), { once: true });
            });

            const result = await Promise.race([
              client.callTool(
                { name: mcpTool.name, arguments: args },
                undefined,
                { signal: controller.signal },
              ),
              timeoutPromise,
            ]);

            // Validate the response shape — untrusted MCP servers may return malformed content.
            const parsedContent = MCPToolContentSchema.safeParse(result.content);
            if (!parsedContent.success) {
              return { content: 'MCP tool returned invalid content shape', isError: true };
            }

            // Handle mixed content types (text, image, resource)
            const parts = parsedContent.data.map(c => {
              if (c.type === 'text' && typeof c.text === 'string') return c.text;
              if (c.type === 'image') {
                const mime = c.mimeType ?? 'unknown';
                const dataLen = typeof c.data === 'string' ? c.data.length : 0;
                const sizeKB = Math.round(dataLen * 0.75 / 1024);
                return `[Image: ${mime}, ~${sizeKB}KB]`;
              }
              if (c.type === 'resource') return c.text ?? `[Resource: ${c.uri ?? 'unknown'}]`;
              return `[${c.type}]`;
            });
            const textContent = parts.join('\n');

            if (result.isError) {
              return { content: textContent || 'MCP tool returned an error', isError: true };
            }

            return textContent || 'Tool completed with no text output';
          } finally {
            clearTimeout(timer);
          }
        } catch (error) {
          if (isolateErrors) {
            return {
              content: `MCP tool error: ${error instanceof Error ? error.message : String(error)}`,
              isError: true,
            };
          }
          throw error;
        }
      },
    };
  }

  /**
   * Connect with transport auto-detection for URL-based configs.
   * When transport is 'auto', tries StreamableHTTP first then falls back to SSE.
   * Explicit 'sse' or 'http' use that transport directly.
   */
  private async connectWithFallback(
    Client: new (opts: { name: string; version: string }) => MCPClient,
    config: MCPConnectionConfig,
  ): Promise<{ client: MCPClient; transport: unknown }> {
    // Explicit transport — use directly, no fallback
    if (config.transport !== 'auto') {
      const client = new Client({ name: `agentx-${config.name}`, version: '0.1.0' }) as MCPClient;
      const transport = await createTransport(config);
      try {
        await client.connect(transport);
        return { client, transport };
      } catch (err) {
        // Release the transport (and any spawned stdio subprocess) on connect failure
        await closeTransportQuietly(transport);
        throw err;
      }
    }

    // Auto-detect: try StreamableHTTP first, fall back to SSE
    const requestInit: RequestInit | undefined = config.headers ? { headers: config.headers } : undefined;

    const client1 = new Client({ name: `agentx-${config.name}`, version: '0.1.0' }) as MCPClient;
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const httpTransport = new StreamableHTTPClientTransport(new URL(config.url!), { requestInit });
    try {
      await client1.connect(httpTransport);
      return { client: client1, transport: httpTransport };
    } catch {
      // StreamableHTTP failed — clean up before falling back
      await closeTransportQuietly(httpTransport);
    }

    const client2 = new Client({ name: `agentx-${config.name}`, version: '0.1.0' }) as MCPClient;
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
    const sseTransport = new SSEClientTransport(new URL(config.url!), { requestInit });
    try {
      await client2.connect(sseTransport);
      return { client: client2, transport: sseTransport };
    } catch (err) {
      await closeTransportQuietly(sseTransport);
      throw err;
    }
  }

  private async healthCheck(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) return;
    // Skip if a reconnect is already in progress — prevents concurrent reconnects.
    if (conn.status === 'reconnecting') return;

    try {
      await conn.client.listTools();
      conn.status = 'connected';
      conn.lastError = undefined;
    } catch (error) {
      // Set reconnecting BEFORE firing attemptReconnect to close the race window.
      conn.status = 'reconnecting';
      conn.lastError = error instanceof Error ? error.message : String(error);
      void this.attemptReconnect(name);
    }
  }

  private async attemptReconnect(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) return;
    // Status is already 'reconnecting' (set atomically in healthCheck).
    const maxRetries = conn.config.maxRetries ?? 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const delay = Math.min(1000 * 2 ** attempt, 30_000);
        await new Promise(r => setTimeout(r, delay));

        const transport = await createTransport(conn.config);
        await conn.client.connect(transport);
        conn.transport = transport;
        conn.status = 'connected';
        conn.lastError = undefined;
        return;
      } catch (error) {
        conn.lastError = error instanceof Error ? error.message : String(error);
      }
    }

    // Failed all retries — remove tools
    conn.status = 'disconnected';
    for (const toolName of conn.toolNames) {
      this.executor.unregister(toolName);
    }
  }
}

// --- SDK Loading ---

async function loadSDK(): Promise<{ Client: new (opts: { name: string; version: string }) => MCPClient }> {
  try {
    const mod = await import('@modelcontextprotocol/sdk/client/index.js');
    // Cast needed because MCP SDK types are broader than our minimal MCPClient interface
    return { Client: mod.Client as unknown as new (opts: { name: string; version: string }) => MCPClient };
  } catch {
    throw new Error(
      'Install @modelcontextprotocol/sdk to use MCP connections: npm install @modelcontextprotocol/sdk'
    );
  }
}

async function closeTransportQuietly(transport: unknown): Promise<void> {
  try {
    const t = transport as { close?: () => unknown } | null;
    if (t && typeof t.close === 'function') await Promise.resolve(t.close());
  } catch { /* best-effort cleanup */ }
}

async function createTransport(config: MCPConnectionConfig): Promise<unknown> {
  const requestInit: RequestInit | undefined = config.headers
    ? { headers: config.headers }
    : undefined;

  if (config.transport === 'stdio') {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    return new StdioClientTransport({ command: config.command!, args: config.args ?? [] });
  }

  if (config.transport === 'sse') {
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
    return new SSEClientTransport(new URL(config.url!), { requestInit });
  }

  if (config.transport === 'http') {
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    return new StreamableHTTPClientTransport(new URL(config.url!), { requestInit });
  }

  throw new Error(`Unsupported MCP transport: ${config.transport}`);
}
