/**
 * Message normalization for API submission.
 *
 * Ensures messages respect LLM API constraints:
 * - tool_result must follow an assistant message with matching tool_calls
 * - Orphaned tool results (no matching tool_call) are removed
 * - Assistant messages with orphaned tool_calls (no matching result) get tool_calls stripped
 * - Empty assistant messages without tool_calls are removed
 *
 * Ported from old_src/utils/messages.ts normalizeMessagesForAPI() — simplified for SDK.
 */

import type { OpenRouterMessage } from '../llm/message-types.js';

/**
 * Normalize messages before sending to the LLM API.
 * Removes orphaned tool results/calls and empty messages.
 */
export function normalizeMessagesForAPI(messages: readonly OpenRouterMessage[]): OpenRouterMessage[] {
  if (messages.length === 0) return [];

  // Collect all tool_call IDs from assistant messages
  const declaredToolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        declaredToolCallIds.add(tc.id);
      }
    }
  }

  // Collect all tool_result IDs from tool messages
  const presentToolResultIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'tool' && msg.tool_call_id) {
      presentToolResultIds.add(msg.tool_call_id);
    }
  }

  const result: OpenRouterMessage[] = [];

  for (const msg of messages) {
    // Remove orphaned tool results (no matching tool_call in any assistant message)
    if (msg.role === 'tool' && msg.tool_call_id) {
      if (!declaredToolCallIds.has(msg.tool_call_id)) continue;
    }

    // Strip orphaned tool_calls from assistant (no matching tool result)
    if (msg.role === 'assistant' && msg.tool_calls) {
      const validCalls = msg.tool_calls.filter(tc => presentToolResultIds.has(tc.id));
      if (validCalls.length === 0) {
        // No valid tool_calls — keep as text-only if has content
        if (msg.content && typeof msg.content === 'string' && msg.content.trim()) {
          result.push({ ...msg, tool_calls: undefined });
        }
        // Otherwise skip empty assistant with no valid tool_calls
        continue;
      }
      if (validCalls.length < msg.tool_calls.length) {
        // Partial: keep only valid tool_calls
        result.push({ ...msg, tool_calls: validCalls });
        continue;
      }
    }

    // Remove empty assistant messages without tool_calls
    if (
      msg.role === 'assistant' &&
      !msg.tool_calls &&
      (!msg.content || (typeof msg.content === 'string' && !msg.content.trim()))
    ) {
      continue;
    }

    result.push(msg);
  }

  return result;
}
