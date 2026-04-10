import type { LLMMessage } from '../llm/message-types.js';
import type { TokenUsage } from '../contracts/entities/token-usage.js';

// --- Terminal (loop exit) ---

/** Why the loop ended */
export type TerminalReason =
  | 'stop'
  | 'abort'
  | 'error'
  | 'cost_limit'
  | 'max_iterations'
  | 'prompt_too_long'
  | 'max_output_tokens'
  | 'stop_hook';

/** Return value of the generator when the loop exits */
export interface Terminal {
  reason: TerminalReason;
  usage: TokenUsage;
  error?: Error;
}

// --- Continue (loop iteration) ---

/** Why the loop continued to the next iteration */
export type ContinueReason =
  | 'next_turn'
  | 'max_output_tokens_escalate'
  | 'max_output_tokens_recovery'
  | 'reactive_compact_retry'
  | 'model_fallback'
  | 'stop_hook_blocking'
  | 'token_budget_continuation';

export interface Continue {
  reason: ContinueReason;
}

// --- Loop State (immutable, replaced atomically at each continue site) ---

export interface AutoCompactTracking {
  lastCompactTurn: number;
  consecutiveFailures: number;
}

export interface LoopState {
  readonly messages: readonly LLMMessage[];
  readonly turnCount: number;
  readonly consecutiveErrors: number;
  readonly maxOutputTokensRecoveryCount: number;
  readonly maxOutputTokensOverride: number | undefined;
  readonly hasAttemptedCompaction: boolean;
  readonly autoCompactTracking: AutoCompactTracking | undefined;
  readonly transition: Continue | undefined;
  /** Tracks tool-level retry attempts (onToolError: 'retry'). */
  readonly toolRetryCount: number;
}

/** Create initial loop state from the starting messages */
export function createInitialState(messages: LLMMessage[]): LoopState {
  return {
    messages,
    turnCount: 1,
    consecutiveErrors: 0,
    maxOutputTokensRecoveryCount: 0,
    maxOutputTokensOverride: undefined,
    hasAttemptedCompaction: false,
    autoCompactTracking: undefined,
    transition: undefined,
    toolRetryCount: 0,
  };
}
