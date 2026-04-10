/**
 * Context analysis — token accounting by role and subsystem.
 *
 * Provides visibility into where tokens are being spent.
 * Ported from old_src/utils/contextAnalysis.ts pattern.
 */

import type { LLMMessage } from '../llm/message-types.js';
import { estimateTokens } from '../utils/token-counter.js';

export interface ContextAnalysis {
  totalTokens: number;
  messageCount: number;
  byRole: {
    system: number;
    user: number;
    assistant: number;
    tool: number;
  };
  toolResultCount: number;
  toolResultChars: number;
}

/**
 * Analyze context messages and return token breakdown.
 */
export function analyzeContext(messages: readonly LLMMessage[]): ContextAnalysis {
  const byRole = { system: 0, user: 0, assistant: 0, tool: 0 };
  let totalTokens = 0;
  let toolResultCount = 0;
  let toolResultChars = 0;

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    const tokens = estimateTokens(content);
    totalTokens += tokens;

    const role = msg.role as keyof typeof byRole;
    if (role in byRole) {
      byRole[role] += tokens;
    }

    if (msg.role === 'tool') {
      toolResultCount++;
      toolResultChars += content.length;
    }
  }

  return {
    totalTokens,
    messageCount: messages.length,
    byRole,
    toolResultCount,
    toolResultChars,
  };
}
