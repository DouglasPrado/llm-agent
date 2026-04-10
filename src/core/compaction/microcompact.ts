import type { LLMMessage } from '../../llm/message-types.js';

export interface MicrocompactOptions {
  maxToolResultChars: number;
  /** Per-tool max chars override, keyed by tool name. Takes precedence over default. */
  perToolMaxChars?: Map<string, number>;
  /** Map from tool_call_id to tool name. Required when perToolMaxChars is used. */
  toolCallIdToName?: Map<string, string>;
}

export interface MicrocompactResult {
  messages: LLMMessage[];
  truncatedCount: number;
}

const DEFAULT_HEAD_RATIO = 0.7;
const DEFAULT_TAIL_RATIO = 0.2;

/**
 * Truncates large tool result messages, preserving head and tail.
 * Runs before autocompact — cheap, no LLM call.
 *
 * Supports per-tool max chars overrides via perToolMaxChars map.
 */
export function microcompact(
  messages: readonly LLMMessage[],
  options: MicrocompactOptions,
): MicrocompactResult {
  const { maxToolResultChars, perToolMaxChars, toolCallIdToName } = options;
  let truncatedCount = 0;

  const result = messages.map(msg => {
    if (msg.role !== 'tool' || typeof msg.content !== 'string') return msg;

    // Determine per-tool limit
    let limit = maxToolResultChars;
    if (perToolMaxChars && toolCallIdToName && msg.tool_call_id) {
      const toolName = toolCallIdToName.get(msg.tool_call_id);
      if (toolName && perToolMaxChars.has(toolName)) {
        limit = perToolMaxChars.get(toolName)!;
      }
    }

    if (msg.content.length <= limit) return msg;

    truncatedCount++;

    const headSize = Math.floor(limit * DEFAULT_HEAD_RATIO);
    const tailSize = Math.floor(limit * DEFAULT_TAIL_RATIO);
    const head = msg.content.slice(0, headSize);
    const tail = msg.content.slice(-tailSize);
    const omitted = msg.content.length - headSize - tailSize;

    return {
      ...msg,
      content: `${head}\n\n[truncated ${omitted} characters]\n\n${tail}`,
    };
  });

  return { messages: result, truncatedCount };
}
