import type { OpenRouterMessage } from '../llm/message-types.js';
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
  messages: OpenRouterMessage[];
  totalTokens: number;
  injections: ContextInjection[];
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
  const messages: OpenRouterMessage[] = [];
  const appliedInjections: ContextInjection[] = [];

  // 1. System prompt
  let systemContent = systemPrompt ?? '';
  const systemTokens = estimateTokens(systemContent);
  used += systemTokens;

  // 2. Injections sorted by priority (higher = more important)
  const sortedInjections = [...injections].sort((a, b) => b.priority - a.priority);
  for (const injection of sortedInjections) {
    if (used + injection.tokens <= budget) {
      systemContent += `\n\n${injection.content}`;
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

  // Include pinned first
  for (const msg of pinned) {
    const tokens = estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
    if (used + tokens <= budget) {
      messages.push(chatMessageToOpenRouter(msg));
      used += tokens;
    }
  }

  // Include unpinned from most recent, fill remaining budget
  const unpinnedReversed = [...unpinned].reverse();
  const unpinnedToInclude: OpenRouterMessage[] = [];
  for (const msg of unpinnedReversed) {
    const tokens = estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
    if (used + tokens <= budget) {
      unpinnedToInclude.unshift(chatMessageToOpenRouter(msg));
      used += tokens;
    } else {
      break;
    }
  }
  messages.push(...unpinnedToInclude);

  return { messages, totalTokens: used, injections: appliedInjections };
}

function chatMessageToOpenRouter(msg: ChatMessage): OpenRouterMessage {
  const result: OpenRouterMessage = {
    role: msg.role,
    content: typeof msg.content === 'string' ? msg.content : contentPartsToOpenRouter(msg.content),
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

  return result;
}

function contentPartsToOpenRouter(parts: ContentPart[]): string {
  return parts.map(p => {
    if (p.type === 'text') return p.text;
    return `[image: ${p.image_url.url}]`;
  }).join('');
}
