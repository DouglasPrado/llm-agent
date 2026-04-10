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
 * Preserves: system messages, pinned messages, tail messages.
 */
export function snipCompact(
  messages: readonly LLMMessage[],
  options: SnipCompactOptions,
): SnipCompactResult {
  const { tailProtection } = options;

  if (messages.length === 0) return { messages: [], snippedCount: 0 };

  // Separate protected messages
  const system = messages.filter(m => m.role === 'system');
  const pinned = messages.filter(m => (m as unknown as Record<string, unknown>)._pinned === true && m.role !== 'system');
  const rest = messages.filter(m => m.role !== 'system' && (m as unknown as Record<string, unknown>)._pinned !== true);

  const tailCount = Math.min(tailProtection, rest.length);
  const early = rest.slice(0, rest.length - tailCount);
  const tail = rest.slice(-tailCount);

  if (early.length === 0) {
    return { messages: [...messages], snippedCount: 0 };
  }

  // Find tool_call_ids that have a matching assistant tool_call anywhere (early + tail)
  const referencedIds = new Set<string>();
  // From tail: both tool_call_id references and assistant tool_calls
  for (const msg of tail) {
    if (msg.tool_call_id) referencedIds.add(msg.tool_call_id);
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        referencedIds.add(tc.id);
      }
    }
  }
  // From early: only assistant tool_calls (not tool results referencing themselves)
  for (const msg of early) {
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        referencedIds.add(tc.id);
      }
    }
  }

  // Remove orphaned tool results from early messages
  let snippedCount = 0;
  const keptEarly = early.filter(msg => {
    if (msg.role === 'tool' && msg.tool_call_id && !referencedIds.has(msg.tool_call_id)) {
      snippedCount++;
      return false;
    }
    return true;
  });

  return {
    messages: [...system, ...pinned, ...keptEarly, ...tail],
    snippedCount,
  };
}
