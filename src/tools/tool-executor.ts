import { ZodError, type ZodSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AgentTool } from '../contracts/entities/agent-tool.js';
import type { AgentToolResult } from '../contracts/entities/tool-call.js';
import type { ToolDefinition } from '../llm/message-types.js';

export interface ToolCallRequest {
  name: string;
  args: unknown;
}

export interface ToolHooks {
  beforeToolCall?: (name: string, args: unknown) => void | Promise<void>;
  afterToolCall?: (name: string, args: unknown, result: AgentToolResult) => void | Promise<void>;
}

/**
 * Registers tools, validates args via Zod, converts to JSON Schema,
 * and executes tools with hooks.
 */
export class ToolExecutor {
  private readonly tools = new Map<string, AgentTool>();
  private readonly hooks: ToolHooks;

  constructor(hooks: ToolHooks = {}) {
    this.hooks = hooks;
  }

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  listTools(): AgentTool[] {
    return [...this.tools.values()];
  }

  getToolDefinitions(): ToolDefinition[] {
    return this.listTools().map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters as ZodSchema, { target: 'openApi3' }) as Record<string, unknown>,
      },
    }));
  }

  async execute(name: string, args: unknown, signal?: AbortSignal): Promise<AgentToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Tool "${name}" not found`, isError: true };
    }

    // Validate args via Zod
    let validatedArgs: unknown;
    try {
      validatedArgs = (tool.parameters as ZodSchema).parse(args);
    } catch (error) {
      if (error instanceof ZodError) {
        return { content: `Validation error: ${error.errors.map(e => e.message).join(', ')}`, isError: true };
      }
      return { content: `Validation error: ${String(error)}`, isError: true };
    }

    // Before hook
    if (this.hooks.beforeToolCall) {
      await this.hooks.beforeToolCall(name, validatedArgs);
    }

    // Execute
    let result: AgentToolResult;
    try {
      const abortSignal = signal ?? new AbortController().signal;
      const raw = await tool.execute(validatedArgs, abortSignal);
      result = typeof raw === 'string' ? { content: raw } : raw;
    } catch (error) {
      result = { content: `Tool error: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }

    // After hook
    if (this.hooks.afterToolCall) {
      await this.hooks.afterToolCall(name, validatedArgs, result);
    }

    return result;
  }

  async executeParallel(calls: ToolCallRequest[], signal?: AbortSignal): Promise<AgentToolResult[]> {
    return Promise.all(calls.map(call => this.execute(call.name, call.args, signal)));
  }
}
