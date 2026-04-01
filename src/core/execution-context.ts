import { randomUUID } from 'node:crypto';
import type { ExecutionContext as IExecutionContext } from '../contracts/entities/execution-context.js';

/**
 * Creates a new execution context with a unique traceId.
 */
export function createExecutionContext(threadId: string, model: string, parentTraceId?: string): IExecutionContext {
  return {
    traceId: randomUUID(),
    threadId,
    startedAt: Date.now(),
    model,
    parentTraceId,
  };
}
