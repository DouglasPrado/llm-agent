import type { ToolExecutor } from '../tools/tool-executor.js';
import type { AgentToolResult } from '../contracts/entities/tool-call.js';

export interface ToolExecutionResult {
  id: string;
  name: string;
  result: AgentToolResult;
  duration: number;
}

export interface ToolProgressInfo {
  toolCallId: string;
  toolName: string;
  data: Record<string, unknown>;
}

type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded';

interface TrackedTool {
  id: string;
  name: string;
  args: string;
  parsedArgs: unknown;
  isSafe: boolean;
  status: ToolStatus;
  result?: AgentToolResult;
  duration?: number;
  promise?: Promise<void>;
  progressEvents: ToolProgressInfo[];
}

/**
 * Executes tools while the LLM is still streaming.
 * Respects concurrency safety: safe tools run in parallel, unsafe tools run alone.
 * Results are always yielded in submission order.
 * Supports progress callbacks — tools can report incremental updates.
 */
export class StreamingToolExecutor {
  private readonly tools: TrackedTool[] = [];
  private readonly executor: ToolExecutor;
  private readonly signal?: AbortSignal;
  private processing = false;
  /** Accumulated progress events from all tools (drained by getProgressEvents) */
  private pendingProgress: ToolProgressInfo[] = [];

  constructor(executor: ToolExecutor, signal?: AbortSignal) {
    this.executor = executor;
    this.signal = signal;
  }

  /** Called during LLM streaming when a tool_call chunk arrives */
  addTool(id: string, name: string, args: string): void {
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(args);
    } catch (e) {
      this.tools.push({
        id, name, args,
        parsedArgs: {},
        isSafe: true,
        status: 'completed',
        result: {
          content: `Tool call arguments are not valid JSON: ${(e as Error).message}`,
          isError: true,
        },
        duration: 0,
        progressEvents: [],
      });
      return;
    }

    const toolDef = this.executor.listTools().find(t => t.name === name);
    const isSafe = toolDef
      ? typeof toolDef.isConcurrencySafe === 'function'
        ? toolDef.isConcurrencySafe(parsedArgs)
        : toolDef.isConcurrencySafe === true
      : false;

    const tracked: TrackedTool = { id, name, args, parsedArgs, isSafe, status: 'queued', progressEvents: [] };
    this.tools.push(tracked);
    void this.processQueue();
  }

  /**
   * Non-blocking: yields completed results in submission order.
   * Call during streaming to drain finished tools without waiting.
   */
  *getCompletedResults(): Generator<ToolExecutionResult> {
    for (const tool of this.tools) {
      if (tool.status === 'completed') {
        if (tool.result === undefined || tool.duration === undefined) {
          throw new Error(`Tool "${tool.id}" completed but result or duration not set`);
        }
        tool.status = 'yielded';
        if (tool.result !== undefined && tool.duration !== undefined) {
          yield { id: tool.id, name: tool.name, result: tool.result, duration: tool.duration };
        }
      } else if (tool.status !== 'yielded') {
        break;
      }
    }
  }

  /**
   * Non-blocking: drains accumulated progress events from all tools.
   * Call during streaming alongside getCompletedResults().
   */
  *getProgressEvents(): Generator<ToolProgressInfo> {
    while (this.pendingProgress.length > 0) {
      yield this.pendingProgress.shift()!;
    }
  }

  /**
   * Blocking: waits for all remaining tools to complete, yielding in order.
   * Call after streaming ends.
   */
  async *getRemainingResults(): AsyncGenerator<ToolExecutionResult> {
    for (const tool of this.tools) {
      if (tool.status === 'yielded') continue;

      if (tool.promise) {
        await tool.promise;
      }

      if (tool.result === undefined || tool.duration === undefined) {
        throw new Error(`Tool "${tool.id}" completed but result or duration not set`);
      }

      tool.status = 'yielded';
      if (tool.result !== undefined && tool.duration !== undefined) {
        yield { id: tool.id, name: tool.name, result: tool.result, duration: tool.duration };
      }
    }
  }

  /**
   * Process the queue respecting concurrency rules:
   * - Multiple consecutive safe tools can execute in parallel
   * - An unsafe tool must execute alone (waits for all prior to finish)
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (true) {
        const nextQueued = this.tools.find(t => t.status === 'queued');
        if (!nextQueued) break;

        const executing = this.tools.filter(t => t.status === 'executing');

        if (nextQueued.isSafe) {
          const hasUnsafeExecuting = executing.some(t => !t.isSafe);
          if (hasUnsafeExecuting) {
            await Promise.all(executing.map(t => t.promise));
            continue;
          }
          this.startTool(nextQueued);
        } else {
          if (executing.length > 0) {
            await Promise.all(executing.map(t => t.promise));
            continue;
          }
          this.startTool(nextQueued);
          await nextQueued.promise;
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private startTool(tracked: TrackedTool): void {
    tracked.status = 'executing';
    tracked.promise = this.executeTool(tracked);
  }

  private async executeTool(tracked: TrackedTool): Promise<void> {
    const start = Date.now();
    const { parsedArgs } = tracked;

    // Build progress callback that accumulates events
    const onProgress = (data: Record<string, unknown>) => {
      const event: ToolProgressInfo = {
        toolCallId: tracked.id,
        toolName: tracked.name,
        data,
      };
      tracked.progressEvents.push(event);
      this.pendingProgress.push(event);
    };

    try {
      const result = await this.executor.execute(tracked.name, parsedArgs, {
        signal: this.signal,
        toolCallId: tracked.id,
        onProgress,
      });
      tracked.result = result;
    } catch (error) {
      tracked.result = {
        content: `Tool error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }

    tracked.duration = Date.now() - start;
    tracked.status = 'completed';
  }
}
