import { describe, it, expect, beforeEach } from 'vitest';
import { SkillManager } from '../../../src/skills/skill-manager.js';
import type { AgentSkill } from '../../../src/contracts/entities/agent-skill.js';

function createSkill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    name: 'test-skill',
    description: 'A test skill',
    instructions: 'Do something',
    ...overrides,
  };
}

describe('SkillManager', () => {
  let manager: SkillManager;

  beforeEach(() => {
    manager = new SkillManager();
  });

  it('should register and list skills', () => {
    manager.register(createSkill({ name: 'a' }));
    manager.register(createSkill({ name: 'b' }));
    expect(manager.listSkills()).toHaveLength(2);
  });

  it('should unregister skills', () => {
    manager.register(createSkill({ name: 'a' }));
    manager.unregister('a');
    expect(manager.listSkills()).toHaveLength(0);
  });

  it('should match by triggerPrefix', async () => {
    manager.register(createSkill({ name: 'review', triggerPrefix: '/review' }));

    const matches = await manager.match('/review this code', { threadId: 't1' });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.name).toBe('review');
  });

  it('should not match prefix if not at start', async () => {
    manager.register(createSkill({ name: 'review', triggerPrefix: '/review' }));

    const matches = await manager.match('please /review this', { threadId: 't1' });
    expect(matches).toHaveLength(0);
  });

  it('should match by custom match function', async () => {
    manager.register(createSkill({
      name: 'code',
      match: (input) => input.includes('write code'),
    }));

    const matches = await manager.match('please write code for me', { threadId: 't1' });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.name).toBe('code');
  });

  it('should prioritize prefix over custom', async () => {
    manager.register(createSkill({
      name: 'prefix-skill',
      triggerPrefix: '/test',
      priority: 1,
    }));
    manager.register(createSkill({
      name: 'custom-skill',
      match: () => true,
      priority: 10,
    }));

    const matches = await manager.match('/test something', { threadId: 't1' });
    expect(matches[0]!.name).toBe('prefix-skill');
  });

  it('should respect exclusive mode', async () => {
    manager.register(createSkill({
      name: 'exclusive-skill',
      triggerPrefix: '/focus',
      exclusive: true,
    }));
    manager.register(createSkill({
      name: 'other-skill',
      match: () => true,
    }));

    const matches = await manager.match('/focus on task', { threadId: 't1' });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.name).toBe('exclusive-skill');
  });

  it('should limit to maxActiveSkills', async () => {
    const mgr = new SkillManager({ maxActiveSkills: 2 });
    mgr.register(createSkill({ name: 'a', match: () => true }));
    mgr.register(createSkill({ name: 'b', match: () => true }));
    mgr.register(createSkill({ name: 'c', match: () => true }));

    const matches = await mgr.match('any input', { threadId: 't1' });
    expect(matches).toHaveLength(2);
  });

  it('should sort by priority when match types are equal', async () => {
    manager.register(createSkill({ name: 'low', match: () => true, priority: 1 }));
    manager.register(createSkill({ name: 'high', match: () => true, priority: 10 }));

    const matches = await manager.match('any', { threadId: 't1' });
    expect(matches[0]!.name).toBe('high');
  });
});
