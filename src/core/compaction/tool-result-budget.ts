/**
 * Tool result budget — aggregate truncation of large tool results.
 *
 * Runs BEFORE microcompact. While microcompact truncates individual messages
 * to a per-message limit, tool-result-budget enforces a GLOBAL budget across
 * all tool result messages. When total tool result chars exceed the budget,
 * the largest results are truncated first.
 *
 * Ported from old_src/utils/toolResultStorage.ts applyToolResultBudget().
 */

import type { LLMMessage } from '../../llm/message-types.js';

const HEAD_RATIO = 0.7;
const TAIL_RATIO = 0.2;

export interface ToolResultBudgetOptions {
  maxTotalToolResultChars: number;
}

export interface ToolResultBudgetResult {
  messages: LLMMessage[];
  truncatedCount: number;
}

/**
 * Apply a global budget to all tool result messages.
 * Truncates the largest tool results first until total is within budget.
 */
export function applyToolResultBudget(
  messages: readonly LLMMessage[],
  options: ToolResultBudgetOptions,
): ToolResultBudgetResult {
  const { maxTotalToolResultChars } = options;

  // Collect tool result indices and sizes
  const toolResults: Array<{ index: number; size: number }> = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.role === 'tool' && typeof msg.content === 'string') {
      toolResults.push({ index: i, size: msg.content.length });
    }
  }

  const totalChars = toolResults.reduce((sum, tr) => sum + tr.size, 0);
  if (totalChars <= maxTotalToolResultChars) {
    return { messages: [...messages], truncatedCount: 0 };
  }

  // Sort by size descending — truncate largest first
  const sorted = [...toolResults].sort((a, b) => b.size - a.size);

  // Calculate how much to cut
  let remaining = totalChars - maxTotalToolResultChars;
  const truncateTargets = new Map<number, number>(); // index → target size

  for (const tr of sorted) {
    if (remaining <= 0) break;

    // Calculate how much this result should be
    const cut = Math.min(remaining, tr.size - 200); // keep at least 200 chars
    if (cut <= 0) continue;

    const targetSize = tr.size - cut;
    truncateTargets.set(tr.index, targetSize);
    remaining -= cut;
  }

  // Apply truncations
  let truncatedCount = 0;
  const result = messages.map((msg, i) => {
    const targetSize = truncateTargets.get(i);
    if (targetSize === undefined) return msg;

    truncatedCount++;
    const content = msg.content as string;

    const headSize = Math.floor(targetSize * HEAD_RATIO);
    const tailSize = Math.floor(targetSize * TAIL_RATIO);
    const head = content.slice(0, headSize);
    const tail = content.slice(-tailSize);
    const omitted = content.length - headSize - tailSize;

    return {
      ...msg,
      content: `${head}\n\n[truncated ${omitted} characters — tool result budget exceeded]\n\n${tail}`,
    };
  });

  return { messages: result, truncatedCount };
}
