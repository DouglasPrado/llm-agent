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

import type { LLMMessage } from '../llm/message-types.js';

/**
 * Normalize messages before sending to the LLM API.
 * Removes orphaned tool results/calls and empty messages, and enforces the
 * positional invariant that every `tool` message must be preceded (in order)
 * by an `assistant` message that declared its tool_call_id via `tool_calls`.
 */
export function normalizeMessagesForAPI(messages: readonly LLMMessage[]): LLMMessage[] {
  if (messages.length === 0) return [];

  // First pass: positional enforcement.
  // Walk messages in order; a tool message is kept only if its tool_call_id has
  // been declared in a prior assistant message's tool_calls. This catches upstream
  // reordering bugs (e.g. a _pinned tool result floated to the top) that would
  // otherwise violate OpenAI's invariant.
  const seenToolCallIds = new Set<string>();
  const positionallyValid: LLMMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const tc of msg.tool_calls) seenToolCallIds.add(tc.id);
      positionallyValid.push(msg);
      continue;
    }
    if (msg.role === 'tool' && msg.tool_call_id) {
      if (!seenToolCallIds.has(msg.tool_call_id)) continue; // orphan-in-position
      positionallyValid.push(msg);
      continue;
    }
    positionallyValid.push(msg);
  }

  // Second pass: strip assistant tool_calls whose result is missing, and drop
  // empty assistants without tool_calls.
  const presentToolResultIds = new Set<string>();
  for (const msg of positionallyValid) {
    if (msg.role === 'tool' && msg.tool_call_id) {
      presentToolResultIds.add(msg.tool_call_id);
    }
  }

  const result: LLMMessage[] = [];
  for (const msg of positionallyValid) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      const validCalls = msg.tool_calls.filter(tc => presentToolResultIds.has(tc.id));
      if (validCalls.length === 0) {
        if (msg.content && typeof msg.content === 'string' && msg.content.trim()) {
          result.push({ ...msg, tool_calls: undefined });
        }
        continue;
      }
      if (validCalls.length < msg.tool_calls.length) {
        result.push({ ...msg, tool_calls: validCalls });
        continue;
      }
    }

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
