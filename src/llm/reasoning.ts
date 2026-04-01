import type { StreamChatParams } from './message-types.js';

/**
 * Adjusts chat parameters based on model family for reasoning support.
 */
export function buildReasoningArgs(model: string): Partial<StreamChatParams> {
  if (model.startsWith('openai/o1') || model.startsWith('openai/o3')) {
    // o1/o3 models: no temperature, no system role
    return { temperature: undefined };
  }

  // Default: no special adjustments
  return {};
}

/**
 * Checks if a model requires removing system messages (e.g. o1).
 */
export function requiresNoSystemRole(model: string): boolean {
  return model.startsWith('openai/o1') || model.startsWith('openai/o3');
}
