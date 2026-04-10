import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock agent-factory
const mockAgent = {
  remember: vi.fn().mockResolvedValue('memory-file.md'),
  getUsage: vi.fn().mockReturnValue({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
  ingestKnowledge: vi.fn().mockResolvedValue(undefined),
  searchKnowledge: vi.fn().mockResolvedValue([]),
  clearHistory: vi.fn(),
  stream: vi.fn(),
  destroy: vi.fn(),
};

const mockGetAgent = vi.fn().mockResolvedValue(mockAgent);

vi.mock(
  '../../../../examples/teams-bot/src/agent-factory.js',
  () => ({
    getAgent: (...args: any[]) => mockGetAgent(...args),
  }),
);

// Mock botbuilder
vi.mock('botbuilder', () => ({
  ActivityTypes: { Typing: 'typing' },
  MessageFactory: { text: (t: string) => ({ text: t, type: 'message' }) },
  TeamsActivityHandler: class {
    onMessage(_fn: any) { (this as any)._onMessage = _fn; }
    onMembersAdded(_fn: any) { (this as any)._onMembersAdded = _fn; }
  },
  TurnContext: {
    removeRecipientMention: vi.fn(),
  },
}));

import { AgentXBot } from '../../../../examples/teams-bot/src/handlers.js';

function createMockContext(text: string, conversationId = 'conv-test-123') {
  const sent: string[] = [];
  return {
    activity: {
      text,
      conversation: { id: conversationId },
      recipient: { id: 'bot-id' },
      membersAdded: [],
    },
    sendActivity: vi.fn(async (msg: any) => {
      sent.push(typeof msg === 'string' ? msg : msg?.text ?? '');
      return { id: 'activity-1' };
    }),
    sendActivities: vi.fn().mockResolvedValue([]),
    updateActivity: vi.fn().mockResolvedValue(undefined),
    _sent: sent,
  };
}

describe('AgentXBot handlers — conversationId isolation', () => {
  let bot: AgentXBot;

  beforeEach(() => {
    vi.clearAllMocks();
    bot = new AgentXBot();
  });

  it('handleChat passes conversationId to getAgent', async () => {
    // stream returns an empty async iterator
    mockAgent.stream.mockReturnValue((async function* () {
      yield { type: 'text_delta', content: 'Hello' };
    })());

    const ctx = createMockContext('hello', 'conv-chat-42');
    // Trigger the onMessage handler
    await (bot as any).handleIncomingMessage(ctx);

    expect(mockGetAgent).toHaveBeenCalledWith('conv-chat-42');
  });

  it('handleReset passes conversationId to getAgent', async () => {
    const ctx = createMockContext('/reset', 'conv-reset-7');
    await (bot as any).handleIncomingMessage(ctx);

    expect(mockGetAgent).toHaveBeenCalledWith('conv-reset-7');
  });

  it('handleUsage passes conversationId to getAgent', async () => {
    const ctx = createMockContext('/usage', 'conv-usage-9');
    await (bot as any).handleIncomingMessage(ctx);

    expect(mockGetAgent).toHaveBeenCalledWith('conv-usage-9');
  });

  it('handleMemory passes conversationId to getAgent', async () => {
    const ctx = createMockContext('/memory user prefers dark mode', 'conv-mem-3');
    await (bot as any).handleIncomingMessage(ctx);

    expect(mockGetAgent).toHaveBeenCalledWith('conv-mem-3');
  });

  it('handleLearn passes conversationId to getAgent', async () => {
    const ctx = createMockContext('/learn some document text here', 'conv-learn-5');
    await (bot as any).handleIncomingMessage(ctx);

    expect(mockGetAgent).toHaveBeenCalledWith('conv-learn-5');
  });

  it('different conversations get different getAgent calls', async () => {
    mockAgent.stream.mockReturnValue((async function* () {
      yield { type: 'text_delta', content: 'Hi' };
    })());
    const ctx1 = createMockContext('hello', 'user-alice');
    await (bot as any).handleIncomingMessage(ctx1);

    mockAgent.stream.mockReturnValue((async function* () {
      yield { type: 'text_delta', content: 'Hi' };
    })());
    const ctx2 = createMockContext('hello', 'user-bob');
    await (bot as any).handleIncomingMessage(ctx2);

    expect(mockGetAgent).toHaveBeenCalledWith('user-alice');
    expect(mockGetAgent).toHaveBeenCalledWith('user-bob');
    expect(mockGetAgent).toHaveBeenCalledTimes(2);
  });
});
