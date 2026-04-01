import type { AgentTool } from '../contracts/entities/agent-tool.js';
import type { AgentToolResult } from '../contracts/entities/tool-call.js';
import type { MCPConnectionConfig } from '../config/config.js';
import type { ToolExecutor } from './tool-executor.js';
import { z } from 'zod';

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
  inputSchema?: {
    type: string;
    properties?: Record<string, { type: string; description?: string }>;
    required?: string[];
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
export class MCPAdapter {
  private readonly executor: ToolExecutor;
  private readonly connections = new Map<string, MCPConnection>();

  constructor(executor: ToolExecutor) {
    this.executor = executor;
  }

  /**
   * Connect to an MCP server and register its tools.
   */
  async connect(config: MCPConnectionConfig): Promise<AgentTool[]> {
    if (this.connections.has(config.name)) {
      throw new Error(`MCP server "${config.name}" already connected`);
    }

    const { Client } = await loadSDK();

    const client = new Client({ name: `pure-agent-${config.name}`, version: '0.1.0' }) as MCPClient;
    const transport = await createTransport(config);

    await client.connect(transport);

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

  private convertTool(serverName: string, mcpTool: MCPToolDef, client: MCPClient, config: MCPConnectionConfig): AgentTool {
    const namespacedName = `mcp__${serverName}__${mcpTool.name}`;

    // Build a Zod schema from JSON Schema (best-effort)
    const parameters = jsonSchemaToZod(mcpTool.inputSchema);

    const isolateErrors = config.isolateErrors ?? true;
    const timeout = config.timeout ?? 30_000;

    return {
      name: namespacedName,
      description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
      parameters,
      execute: async (args: unknown, signal: AbortSignal): Promise<string | AgentToolResult> => {
        try {
          // Create a timeout-aware signal
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeout);
          signal.addEventListener('abort', () => controller.abort(), { once: true });

          try {
            const result = await client.callTool(
              { name: mcpTool.name, arguments: args },
              undefined,
              { signal: controller.signal },
            );

            const textContent = result.content
              .filter(c => c.type === 'text' && c.text)
              .map(c => c.text!)
              .join('\n');

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

  private async healthCheck(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) return;

    try {
      await conn.client.listTools();
      conn.status = 'connected';
      conn.lastError = undefined;
    } catch (error) {
      conn.status = 'error';
      conn.lastError = error instanceof Error ? error.message : String(error);

      // Attempt reconnection
      void this.attemptReconnect(name);
    }
  }

  private async attemptReconnect(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn || conn.status === 'reconnecting') return;

    conn.status = 'reconnecting';
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

async function createTransport(config: MCPConnectionConfig): Promise<unknown> {
  if (config.transport === 'stdio') {
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
    return new StdioClientTransport({ command: config.command!, args: config.args ?? [] });
  }

  if (config.transport === 'sse') {
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
    const url = new URL(config.url!);
    const requestInit: RequestInit | undefined = config.headers
      ? { headers: config.headers }
      : undefined;
    return new SSEClientTransport(url, { requestInit });
  }

  throw new Error(`Unsupported MCP transport: ${config.transport}`);
}

// --- JSON Schema → Zod (best-effort) ---

function jsonSchemaToZod(schema?: MCPToolDef['inputSchema']): z.ZodSchema {
  if (!schema || !schema.properties) return z.object({});

  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set(schema.required ?? []);

  for (const [key, prop] of Object.entries(schema.properties)) {
    let field: z.ZodTypeAny;
    switch (prop.type) {
      case 'string': field = z.string(); break;
      case 'number': case 'integer': field = z.number(); break;
      case 'boolean': field = z.boolean(); break;
      default: field = z.unknown(); break;
    }
    if (prop.description) field = field.describe(prop.description);
    if (!required.has(key)) field = field.optional();
    shape[key] = field;
  }

  return z.object(shape);
}
