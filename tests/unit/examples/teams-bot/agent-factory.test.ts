import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for agent pool — isolation, caching, TTL, and cleanup.
 *
 * Since agentx-sdk is a local file: link, vi.mock doesn't reliably intercept it.
 * Instead we mock config + tools so Agent.create succeeds with minimal setup,
 * then test pool behavior through exported functions.
 */

vi.mock(
  '../../../../examples/teams-bot/src/config.js',
  () => ({
    config: {
      agent: { apiKey: 'test-key', model: 'test-model' },
      mcp: { albert: { url: undefined } },
      database: { url: undefined },
    },
  }),
);

vi.mock(
  '../../../../examples/teams-bot/src/tools.js',
  () => ({
    createTools: vi.fn(() => []),
  }),
);

vi.mock(
  '../../../../examples/teams-bot/src/queries.js',
  () => ({
    queries: [],
  }),
);

vi.mock('pg', () => ({
  default: { Pool: vi.fn() },
  Pool: vi.fn(),
}));

vi.mock(
  '../../../../examples/teams-bot/src/skills/push-campaign.js',
  () => ({ pushCampaignSkill: { name: 'push_campaign', description: 'stub', instructions: 'stub', inputSchema: { type: 'object', properties: {} } } }),
);

vi.mock(
  '../../../../examples/teams-bot/src/skills/onboarding.js',
  () => ({ onboardingSkill: { name: 'onboarding', description: 'stub', instructions: 'stub', inputSchema: { type: 'object', properties: {} } } }),
);

vi.mock(
  '../../../../examples/teams-bot/src/skills/blog-content.js',
  () => ({ blogContentSkill: { name: 'blog_content', description: 'stub', instructions: 'stub', inputSchema: { type: 'object', properties: {} } } }),
);

// Mock fetch to prevent real HTTP calls from Agent internals
vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

import {
  getAgent,
  destroyAgent,
  destroyAll,
  getPoolStats,
  _resetPool,
} from '../../../../examples/teams-bot/src/agent-factory.js';

describe('Agent Pool (agent-factory)', () => {
  beforeEach(() => {
    _resetPool();
  });

  afterEach(async () => {
    await destroyAll();
  });

  it('creates isolated agents for different conversations', async () => {
    const agent1 = await getAgent('conv-1');
    const agent2 = await getAgent('conv-2');

    expect(agent1).not.toBe(agent2);
    expect(getPoolStats().size).toBe(2);
  });

  it('returns cached agent for same conversationId', async () => {
    const first = await getAgent('conv-1');
    const second = await getAgent('conv-1');

    expect(first).toBe(second);
    expect(getPoolStats().size).toBe(1);
  });

  it('deduplicates concurrent init for same conversationId', async () => {
    const [a, b] = await Promise.all([
      getAgent('conv-1'),
      getAgent('conv-1'),
    ]);

    expect(a).toBe(b);
    expect(getPoolStats().size).toBe(1);
  });

  it('getPoolStats returns correct size and ids', async () => {
    await getAgent('conv-a');
    await getAgent('conv-b');

    const stats = getPoolStats();
    expect(stats.size).toBe(2);
    expect(stats.conversationIds).toContain('conv-a');
    expect(stats.conversationIds).toContain('conv-b');
  });

  it('destroyAgent removes from pool', async () => {
    const agent = await getAgent('conv-1');
    const destroySpy = vi.spyOn(agent, 'destroy');
    expect(getPoolStats().size).toBe(1);

    await destroyAgent('conv-1');

    expect(getPoolStats().size).toBe(0);
    expect(destroySpy).toHaveBeenCalledOnce();
  });

  it('destroyAgent does nothing for unknown conversationId', async () => {
    await destroyAgent('nonexistent');
    expect(getPoolStats().size).toBe(0);
  });

  it('destroyAll clears entire pool', async () => {
    const agents = await Promise.all([
      getAgent('conv-1'),
      getAgent('conv-2'),
      getAgent('conv-3'),
    ]);
    const spies = agents.map(a => vi.spyOn(a, 'destroy'));
    expect(getPoolStats().size).toBe(3);

    await destroyAll();

    expect(getPoolStats().size).toBe(0);
    for (const spy of spies) {
      expect(spy).toHaveBeenCalledOnce();
    }
  });

  it('getAgent after destroyAgent creates a new agent', async () => {
    const first = await getAgent('conv-1');
    await destroyAgent('conv-1');

    const second = await getAgent('conv-1');
    expect(second).not.toBe(first);
  });
});
