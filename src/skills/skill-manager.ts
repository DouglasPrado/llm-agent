import type { AgentSkill } from '../contracts/entities/agent-skill.js';
import type { EmbeddingService } from '../knowledge/embedding-service.js';

export interface SkillMatchResult {
  skill: AgentSkill;
  matchType: 'prefix' | 'custom' | 'semantic';
  score: number;
}

/**
 * Registers skills and matches them against user input.
 * Matching hierarchy: prefix (exact) > custom match() > semantic similarity.
 */
export class SkillManager {
  private readonly skills = new Map<string, AgentSkill>();
  private readonly embeddingService?: EmbeddingService;
  private readonly maxActiveSkills: number;

  constructor(options?: { embeddingService?: EmbeddingService; maxActiveSkills?: number }) {
    this.embeddingService = options?.embeddingService;
    this.maxActiveSkills = options?.maxActiveSkills ?? 3;
  }

  register(skill: AgentSkill): void {
    this.skills.set(skill.name, skill);
  }

  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  listSkills(): AgentSkill[] {
    return [...this.skills.values()];
  }

  /**
   * Matches skills against input. Returns top skills sorted by priority.
   */
  async match(input: string, context: { threadId: string }): Promise<AgentSkill[]> {
    const matches: SkillMatchResult[] = [];

    for (const skill of this.skills.values()) {
      // 1. Prefix match (highest priority)
      if (skill.triggerPrefix && input.startsWith(skill.triggerPrefix)) {
        matches.push({ skill, matchType: 'prefix', score: 1.0 });
        continue;
      }

      // 2. Custom match function
      if (skill.match && skill.match(input, { threadId: context.threadId, recentMessages: 0 })) {
        matches.push({ skill, matchType: 'custom', score: 0.8 });
        continue;
      }
    }

    // 3. Semantic match (if embedding service available and no prefix/custom matches)
    if (this.embeddingService && matches.length === 0) {
      const semanticMatches = await this.semanticMatch(input);
      matches.push(...semanticMatches);
    }

    // Sort: exclusive first, then by match type priority, then by skill.priority
    const sorted = matches.sort((a, b) => {
      // Exclusive skills first
      if (a.skill.exclusive && !b.skill.exclusive) return -1;
      if (!a.skill.exclusive && b.skill.exclusive) return 1;

      // By match type specificity
      const typeOrder = { prefix: 3, custom: 2, semantic: 1 };
      const typeDiff = typeOrder[b.matchType] - typeOrder[a.matchType];
      if (typeDiff !== 0) return typeDiff;

      // By priority (higher is better)
      return (b.skill.priority ?? 0) - (a.skill.priority ?? 0);
    });

    // If exclusive skill matched, return only it
    if (sorted[0]?.skill.exclusive) {
      return [sorted[0].skill];
    }

    return sorted.slice(0, this.maxActiveSkills).map(m => m.skill);
  }

  private async semanticMatch(input: string): Promise<SkillMatchResult[]> {
    if (!this.embeddingService) return [];

    const inputEmbedding = await this.embeddingService.embedSingle(input);
    const results: SkillMatchResult[] = [];

    for (const skill of this.skills.values()) {
      const skillEmbedding = await this.embeddingService.embedSingle(skill.description);
      const score = cosineSimilarity(inputEmbedding, skillEmbedding);

      if (score > 0.7) {
        results.push({ skill, matchType: 'semantic', score });
      }
    }

    return results;
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
