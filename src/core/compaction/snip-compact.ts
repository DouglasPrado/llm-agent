/**
 * Snip compact — removes low-value early messages before autocompact.
 *
 * Targets orphaned tool results (results not referenced by later messages)
 * in the compactable region (outside tail protection).
 *
 * Runs between tool-result-budget and autocompact in the compaction pipeline.
 */

import type { LLMMessage } from '../../llm/message-types.js';

export interface SnipCompactOptions {
  tailProtection: number;
}

export interface SnipCompactResult {
  messages: LLMMessage[];
  snippedCount: number;
}

/**
 * Remove orphaned tool results from early messages.
 * Preserves: original message order (critical for OpenAI's invariant that a
 * `tool` message must be preceded by an `assistant` message with matching
 * `tool_calls`). Pinned messages and the tail window are immune to snipping.
 */
export function snipCompact(
  messages: readonly LLMMessage[],
  options: SnipCompactOptions,
): SnipCompactResult {
  const { tailProtection } = options;

  if (messages.length === 0) return { messages: [], snippedCount: 0 };

  // Determine tail boundary among non-system messages, walking from the end
  // backwards. Anything with a smaller index than `tailStartIdx` is "early"
  // (snipping-eligible). System messages are never in the tail count.
  const nonSystemIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]!.role !== 'system') nonSystemIndices.push(i);
  }
  const tailStartIdx = nonSystemIndices.length <= tailProtection
    ? 0
    : nonSystemIndices[nonSystemIndices.length - tailProtection]!;

  // Collect tool_call ids that are referenced by any assistant in the conversation,
  // plus tool_call_id references inside the tail window. Early tool results outside
  // this set are orphans and get snipped.
  const referencedIds = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) referencedIds.add(tc.id);
    }
    if (i >= tailStartIdx && msg.tool_call_id) {
      referencedIds.add(msg.tool_call_id);
    }
  }

  // Walk in order; drop early orphaned tool results; keep everything else where it is.
  let snippedCount = 0;
  const result: LLMMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const isEarly = i < tailStartIdx && msg.role !== 'system';
    const isPinned = (msg as unknown as Record<string, unknown>)._pinned === true;
    if (
      isEarly &&
      !isPinned &&
      msg.role === 'tool' &&
      msg.tool_call_id &&
      !referencedIds.has(msg.tool_call_id)
    ) {
      snippedCount++;
      continue;
    }
    result.push(msg);
  }

  return { messages: result, snippedCount };
}
