import type { LLMMessage } from '../llm/message-types.js';

export interface StopHookContext {
  messages: readonly LLMMessage[];
  assistantText: string;
  turnCount: number;
}

export interface StopHookResult {
  blockingErrors: string[];
  preventContinuation: boolean;
}

/** A hook that runs when the model produces a final response (no tool calls) */
export interface StopHook {
  name: string;
  execute(context: StopHookContext): Promise<StopHookResult>;
}

/** Run all stop hooks, merge results */
export async function runStopHooks(
  hooks: StopHook[],
  context: StopHookContext,
): Promise<StopHookResult> {
  const allErrors: string[] = [];
  let preventContinuation = false;

  for (const hook of hooks) {
    try {
      const result = await hook.execute(context);
      allErrors.push(...result.blockingErrors);
      if (result.preventContinuation) preventContinuation = true;
    } catch {
      // Stop hooks should not break the loop
    }
  }

  return { blockingErrors: allErrors, preventContinuation };
}
