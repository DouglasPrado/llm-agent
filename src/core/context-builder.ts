import type { LLMMessage } from '../llm/message-types.js';
import type { ChatMessage } from '../contracts/entities/chat-message.js';
import type { ContentPart } from '../contracts/entities/content-part.js';
import { estimateTokens } from '../utils/token-counter.js';

export interface ContextInjection {
  source: string;
  priority: number;
  content: string;
  tokens: number;
}

export interface ContextBuildResult {
  messages: LLMMessage[];
  totalTokens: number;
  injections: ContextInjection[];
  /** Count of pinned messages that did not fit in the budget and were omitted. */
  droppedPinnedCount: number;
}

/**
 * Builds the full context (system prompt + injections + history) within a token budget.
 */
export function buildContext(options: {
  systemPrompt?: string;
  injections: ContextInjection[];
  history: ChatMessage[];
  maxTokens: number;
  reserveTokens: number;
  maxPinnedMessages: number;
}): ContextBuildResult {
  const { systemPrompt, injections, history, maxTokens, reserveTokens, maxPinnedMessages } = options;
  const budget = maxTokens - reserveTokens;
  let used = 0;
  const messages: LLMMessage[] = [];
  const appliedInjections: ContextInjection[] = [];

  // 1. System prompt
  let systemContent = systemPrompt ?? '';
  const systemTokens = estimateTokens(systemContent);
  used += systemTokens;

  // 2. Injections sorted by priority (higher = more important), wrapped in <system-reminder>
  const sortedInjections = [...injections].sort((a, b) => b.priority - a.priority);
  for (const injection of sortedInjections) {
    if (used + injection.tokens <= budget) {
      systemContent += `\n\n<system-reminder>\n${injection.content}\n</system-reminder>`;
      used += injection.tokens;
      appliedInjections.push(injection);
    }
  }

  if (systemContent) {
    messages.push({ role: 'system', content: systemContent });
  }

  // 3. History — pinned messages always included, then recent messages
  const pinned = history.filter(m => m.pinned).slice(0, maxPinnedMessages);
  const unpinned = history.filter(m => !m.pinned);

  // Include pinned first. Track how many did not fit so the caller can surface
  // a warning instead of silently losing critical context.
  let droppedPinnedCount = 0;
  for (const msg of pinned) {
    const tokens = estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
    if (used + tokens <= budget) {
      messages.push(chatMessageToLLM(msg));
      used += tokens;
    } else {
      droppedPinnedCount++;
    }
  }

  // Include unpinned from most recent, fill remaining budget
  const unpinnedReversed = [...unpinned].reverse();
  const unpinnedToInclude: LLMMessage[] = [];
  for (const msg of unpinnedReversed) {
    const tokens = estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
    if (used + tokens <= budget) {
      unpinnedToInclude.unshift(chatMessageToLLM(msg));
      used += tokens;
    } else {
      break;
    }
  }
  messages.push(...unpinnedToInclude);

  // 4. Merge consecutive same-role messages (API constraint: no consecutive user/user)
  const merged = mergeConsecutiveMessages(messages);

  return { messages: merged, totalTokens: used, injections: appliedInjections, droppedPinnedCount };
}

/**
 * Merge consecutive messages with the same role.
 * Prevents API errors from consecutive user or assistant messages.
 */
function mergeConsecutiveMessages(messages: LLMMessage[]): LLMMessage[] {
  if (messages.length <= 1) return messages;

  const result: LLMMessage[] = [messages[0]!];

  for (let i = 1; i < messages.length; i++) {
    const current = messages[i]!;
    const prev = result[result.length - 1]!;

    // Only merge user+user or assistant+assistant (not system, not tool)
    if (
      current.role === prev.role &&
      (current.role === 'user' || current.role === 'assistant') &&
      typeof prev.content === 'string' &&
      typeof current.content === 'string' &&
      !current.tool_call_id &&
      !prev.tool_calls
    ) {
      result[result.length - 1] = { ...prev, content: `${prev.content}\n\n${current.content}` };
    } else {
      result.push(current);
    }
  }

  return result;
}

function chatMessageToLLM(msg: ChatMessage): LLMMessage {
  const result: LLMMessage = {
    role: msg.role,
    content: typeof msg.content === 'string' ? msg.content : contentPartsToLLM(msg.content),
  };

  if (msg.toolCalls) {
    result.tool_calls = msg.toolCalls.map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));
  }

  if (msg.toolCallId) {
    result.tool_call_id = msg.toolCallId;
  }

  // Propagate pinned status so autocompact/snipCompact honour it in resumed sessions.
  if (msg.pinned) {
    (result as unknown as Record<string, unknown>)._pinned = true;
  }

  return result;
}

function contentPartsToLLM(parts: ContentPart[]): string {
  return parts.map(p => {
    if (p.type === 'text') return p.text;
    if (p.type === 'image_url' && p.image_url?.url) return `[image: ${p.image_url.url}]`;
    return '';
  }).filter(Boolean).join('');
}
