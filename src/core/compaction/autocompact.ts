import type { LLMMessage } from '../../llm/message-types.js';
import type { LLMClient } from '../../llm/llm-client.js';
import { estimateTokens } from '../../utils/token-counter.js';

export interface AutocompactOptions {
  maxContextTokens: number;
  compactionThreshold: number; // 0.0-1.0, e.g. 0.8 = compact at 80% usage
  tailProtection: number; // Number of recent messages to always preserve
}

export interface AutocompactResult {
  messages: LLMMessage[];
  tokensFreed: number;
}

function estimateMessagesTokens(messages: readonly LLMMessage[]): number {
  return messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + estimateTokens(content);
  }, 0);
}

/**
 * Summarizes conversation history via LLM when token usage exceeds threshold.
 * Preserves: system messages (always), tail messages (recent context).
 * Returns null if compaction not needed or fails.
 */
export async function autocompact(
  messages: readonly LLMMessage[],
  client: LLMClient,
  options: AutocompactOptions,
): Promise<AutocompactResult | null> {
  const { maxContextTokens, compactionThreshold, tailProtection } = options;

  const currentTokens = estimateMessagesTokens(messages);
  const threshold = maxContextTokens * compactionThreshold;

  if (currentTokens < threshold) return null;

  // Split into: system messages, a compactable region (early), and a protected
  // tail. Pinned messages in the early region are preserved in their ORIGINAL
  // position (not floated to the top) to keep assistant.tool_calls followed by
  // their `tool` results — OpenAI rejects any other order.
  const systemMessages = messages.filter(m => m.role === 'system');
  const nonSystem = messages.filter(m => m.role !== 'system');
  const tailCount = Math.min(tailProtection, nonSystem.length);
  const earlyNonSystem = nonSystem.slice(0, nonSystem.length - tailCount);
  const tailMessages = nonSystem.slice(-tailCount);

  // Within the early region, split into pinned (kept verbatim, in place) and
  // compactable (summarized). The relative order of pinned messages to each
  // other is preserved; they are emitted at the top of the early slot.
  const earlyPinned = earlyNonSystem.filter(m => (m as unknown as Record<string, unknown>)._pinned === true);
  const toCompact = earlyNonSystem.filter(m => (m as unknown as Record<string, unknown>)._pinned !== true);

  if (toCompact.length === 0) return null;

  // Build conversation text for summarization
  const conversationText = toCompact.map(m => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return `${m.role}: ${content.slice(0, 2000)}`; // Limit per message for the summary prompt
  }).join('\n');

  try {
    const response = await client.chat({
      messages: [
        {
          role: 'system',
          content: 'You are a conversation summarizer. Create a concise summary of the following conversation, preserving key facts, decisions, tool results, and context needed for continuation. Be factual and specific. Output only the summary.',
        },
        { role: 'user', content: conversationText },
      ],
      temperature: 0,
      maxTokens: 1000,
    });

    const summaryMessage: LLMMessage = {
      role: 'user',
      content: `[Conversation summary — earlier messages were compacted to save context]\n\n${response.content}`,
      // Mark as compaction boundary — should survive subsequent compactions
      _pinned: true,
    } as LLMMessage & { _pinned?: boolean };

    const compactedMessages = [
      ...systemMessages,
      ...earlyPinned,
      summaryMessage,
      ...tailMessages,
    ];

    const newTokens = estimateMessagesTokens(compactedMessages);
    return {
      messages: compactedMessages,
      tokensFreed: currentTokens - newTokens,
    };
  } catch {
    return null;
  }
}
