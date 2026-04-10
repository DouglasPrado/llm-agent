import type { AgentSkill, SkillPromptContext } from '../contracts/entities/agent-skill.js';
import type { EmbeddingService } from '../knowledge/embedding-service.js';
import { scanSkillFiles } from './skill-loader.js';
import { substituteArgs } from './skill-args.js';
import { matchAnyGlob } from './skill-glob.js';

export interface SkillMatchResult {
  skill: AgentSkill;
  matchType: 'prefix' | 'alias' | 'custom' | 'semantic' | 'sticky';
  score: number;
}

interface StickySession {
  skillName: string;
  activatedAt: number;
  /** Infinity for sticky=true, N for sticky=N (decremented each turn) */
  turnsRemaining: number;
}

const MAX_LISTING_DESC_CHARS = 250;

/**
 * Registers skills, matches them against user input, manages conditional
 * activation, and provides budget-aware skill listings for model discovery.
 *
 * Matching hierarchy: prefix > alias > custom match() > semantic similarity.
 */
export class SkillManager {
  /** All registered skills (unconditional — always eligible for matching) */
  private readonly skills = new Map<string, AgentSkill>();
  /** Skills with `paths` — waiting for file touch to activate */
  private readonly conditionalSkills = new Map<string, AgentSkill>();
  /** Skills activated via path matching (moved from conditionalSkills) */
  private readonly activatedSkills = new Map<string, AgentSkill>();
  /** Tracks which skills have been invoked in this session */
  private readonly invokedSkills = new Set<string>();
  /** Sticky skill sessions per thread — outer key: threadId, inner key: skillName */
  private readonly stickySessions = new Map<string, Map<string, StickySession>>();

  private readonly embeddingService?: EmbeddingService;
  private readonly maxActiveSkills: number;

  constructor(options?: { embeddingService?: EmbeddingService; maxActiveSkills?: number }) {
    this.embeddingService = options?.embeddingService;
    this.maxActiveSkills = options?.maxActiveSkills ?? 3;
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  register(skill: AgentSkill): void {
    if (skill.paths && skill.paths.length > 0) {
      this.conditionalSkills.set(skill.name, skill);
    } else {
      this.skills.set(skill.name, skill);
    }
  }

  unregister(name: string): boolean {
    return this.skills.delete(name)
      || this.conditionalSkills.delete(name)
      || this.activatedSkills.delete(name);
  }

  /** All skills (unconditional + activated conditional) */
  listSkills(): AgentSkill[] {
    return [...this.skills.values(), ...this.activatedSkills.values()];
  }

  /** All skills including pending conditional ones */
  listAllSkills(): AgentSkill[] {
    return [
      ...this.skills.values(),
      ...this.activatedSkills.values(),
      ...this.conditionalSkills.values(),
    ];
  }

  // ---------------------------------------------------------------------------
  // File-based loading
  // ---------------------------------------------------------------------------

  /**
   * Load skills from a directory containing SKILL.md files.
   * Returns the number of skills loaded.
   */
  async loadFromDirectory(dir: string): Promise<number> {
    const skills = await scanSkillFiles(dir);
    for (const skill of skills) {
      this.register(skill);
    }
    return skills.length;
  }

  // ---------------------------------------------------------------------------
  // Conditional path activation
  // ---------------------------------------------------------------------------

  /**
   * Activate conditional skills whose `paths` match any of the given file paths.
   * Returns the names of newly activated skills.
   */
  activateForPaths(filePaths: string[]): string[] {
    const activated: string[] = [];

    for (const [name, skill] of this.conditionalSkills) {
      if (!skill.paths) continue;
      const matched = filePaths.some(fp => matchAnyGlob(skill.paths!, fp));
      if (matched) {
        this.activatedSkills.set(name, skill);
        this.conditionalSkills.delete(name);
        activated.push(name);
      }
    }

    return activated;
  }

  // ---------------------------------------------------------------------------
  // Matching
  // ---------------------------------------------------------------------------

  /**
   * Matches skills against input. Returns top skills sorted by priority.
   */
  async match(input: string, context: { threadId: string }): Promise<AgentSkill[]> {
    const matches: SkillMatchResult[] = [];
    const matchedNames = new Set<string>();
    const eligible = this.getEligibleSkills();

    // 0. Sticky sessions — re-inject skills that are active for this thread
    const threadSessions = this.stickySessions.get(context.threadId);
    if (threadSessions) {
      for (const [skillName, session] of threadSessions) {
        if (session.turnsRemaining <= 0) {
          threadSessions.delete(skillName);
          continue;
        }
        const skill = this.skills.get(skillName) ?? this.activatedSkills.get(skillName);
        if (skill) {
          matches.push({ skill, matchType: 'sticky', score: 0.9 });
          matchedNames.add(skillName);
        }
      }
      // Clean up empty thread entry
      if (threadSessions.size === 0) {
        this.stickySessions.delete(context.threadId);
      }
    }

    for (const skill of eligible) {
      if (matchedNames.has(skill.name)) continue;

      // 1. Prefix match (highest priority)
      if (skill.triggerPrefix && input.startsWith(skill.triggerPrefix)) {
        matches.push({ skill, matchType: 'prefix', score: 1.0 });
        matchedNames.add(skill.name);
        continue;
      }

      // 2. Alias match
      if (skill.aliases) {
        const matched = skill.aliases.some(alias => {
          const prefix = alias.startsWith('/') ? alias : `/${alias}`;
          return input.startsWith(prefix);
        });
        if (matched) {
          matches.push({ skill, matchType: 'alias', score: 0.95 });
          matchedNames.add(skill.name);
          continue;
        }
      }

      // 3. Custom match function
      if (skill.match && skill.match(input, { threadId: context.threadId, recentMessages: 0 })) {
        matches.push({ skill, matchType: 'custom', score: 0.8 });
        matchedNames.add(skill.name);
        continue;
      }
    }

    // 4. Semantic match — only if no prefix/alias/custom/sticky matches found
    //    and there are skills that lack explicit matchers
    if (this.embeddingService && matches.length === 0 && this.hasSkillsNeedingSemantic(eligible)) {
      const semanticMatches = await this.semanticMatch(input, eligible);
      matches.push(...semanticMatches);
    }

    // Sort: exclusive first, then by match type priority, then by skill.priority
    const sorted = matches.sort((a, b) => {
      if (a.skill.exclusive && !b.skill.exclusive) return -1;
      if (!a.skill.exclusive && b.skill.exclusive) return 1;

      const typeOrder: Record<string, number> = { prefix: 4, sticky: 3.5, alias: 3, custom: 2, semantic: 1 };
      const typeDiff = (typeOrder[b.matchType] ?? 0) - (typeOrder[a.matchType] ?? 0);
      if (typeDiff !== 0) return typeDiff;

      return (b.skill.priority ?? 0) - (a.skill.priority ?? 0);
    });

    // Activate sticky sessions for newly matched skills and decrement turn counters
    for (const match of sorted) {
      if (match.skill.sticky) {
        this.activateStickySession(context.threadId, match.skill);
      }
    }
    this.decrementStickySessions(context.threadId);

    // If exclusive skill matched, return only it
    if (sorted[0]?.skill.exclusive) {
      return [sorted[0].skill];
    }

    return sorted.slice(0, this.maxActiveSkills).map(m => m.skill);
  }

  // ---------------------------------------------------------------------------
  // Dynamic prompt resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolve the final instructions for a matched skill.
   * If `getPrompt` exists, calls it with args and context.
   * Otherwise uses static `instructions` with argument substitution.
   */
  async resolveInstructions(
    skill: AgentSkill,
    args: string,
    context: SkillPromptContext,
  ): Promise<string> {
    if (skill.getPrompt) {
      return skill.getPrompt(args, context);
    }

    // Static instructions with optional substitution
    if (skill.argNames && skill.argNames.length > 0) {
      return substituteArgs(skill.instructions, args, skill.argNames, {
        SKILL_DIR: context.skillDir ?? skill.skillDir ?? '',
        THREAD_ID: context.threadId,
        TRACE_ID: context.traceId,
      });
    }

    return skill.instructions;
  }

  // ---------------------------------------------------------------------------
  // Budget-aware listing for model discovery
  // ---------------------------------------------------------------------------

  /**
   * Build a formatted listing of available skills for model context.
   * Truncates to fit within the given character budget.
   */
  buildSkillListing(budgetChars: number): string {
    const eligible = this.getEligibleSkills()
      .filter(s => s.modelInvocable !== false);

    if (eligible.length === 0) return '';

    const lines: string[] = [];
    let usedChars = 0;

    for (const skill of eligible) {
      const prefix = skill.triggerPrefix
        ? skill.triggerPrefix
        : `/${skill.name}`;

      let line = `- ${prefix}: ${skill.description}`;
      if (skill.whenToUse) {
        line += ` — ${skill.whenToUse}`;
      }

      // Truncate individual entry
      if (line.length > MAX_LISTING_DESC_CHARS) {
        line = line.slice(0, MAX_LISTING_DESC_CHARS - 3) + '...';
      }

      if (usedChars + line.length > budgetChars) break;
      lines.push(line);
      usedChars += line.length + 1; // +1 for newline
    }

    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Invocation tracking
  // ---------------------------------------------------------------------------

  markInvoked(name: string): void {
    this.invokedSkills.add(name);
  }

  getInvokedSkills(): string[] {
    return [...this.invokedSkills];
  }

  // ---------------------------------------------------------------------------
  // Sticky session management
  // ---------------------------------------------------------------------------

  /** Remove a single sticky skill from a thread */
  clearStickySkill(threadId: string, skillName: string): void {
    this.stickySessions.get(threadId)?.delete(skillName);
  }

  /** Remove all sticky skills for a thread (e.g. on clearHistory) */
  clearStickySkills(threadId: string): void {
    this.stickySessions.delete(threadId);
  }

  /** Remove all sticky sessions across all threads (e.g. on destroy) */
  clearAllStickySessions(): void {
    this.stickySessions.clear();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private activateStickySession(threadId: string, skill: AgentSkill): void {
    if (!this.stickySessions.has(threadId)) {
      this.stickySessions.set(threadId, new Map());
    }
    const sessions = this.stickySessions.get(threadId)!;
    // Don't reset an existing session (first activation wins)
    if (!sessions.has(skill.name)) {
      sessions.set(skill.name, {
        skillName: skill.name,
        activatedAt: Date.now(),
        turnsRemaining: skill.sticky === true ? Infinity : (skill.sticky as number),
      });
    }
  }

  private decrementStickySessions(threadId: string): void {
    const sessions = this.stickySessions.get(threadId);
    if (!sessions) return;
    for (const session of sessions.values()) {
      if (session.turnsRemaining !== Infinity) {
        session.turnsRemaining--;
      }
    }
  }

  /** Get all skills eligible for matching (unconditional + activated) */
  private getEligibleSkills(): AgentSkill[] {
    const eligible: AgentSkill[] = [];
    for (const skill of this.skills.values()) {
      if (skill.isEnabled && !skill.isEnabled()) continue;
      eligible.push(skill);
    }
    for (const skill of this.activatedSkills.values()) {
      if (skill.isEnabled && !skill.isEnabled()) continue;
      eligible.push(skill);
    }
    return eligible;
  }

  /**
   * Returns true if any eligible skill lacks both triggerPrefix, aliases, and match(),
   * meaning it can only be activated via semantic matching.
   */
  private hasSkillsNeedingSemantic(eligible: AgentSkill[]): boolean {
    return eligible.some(s => !s.triggerPrefix && !s.aliases?.length && !s.match);
  }

  private async semanticMatch(
    input: string,
    eligible: AgentSkill[],
  ): Promise<SkillMatchResult[]> {
    if (!this.embeddingService) return [];

    const inputEmbedding = await this.embeddingService.embedSingle(input);
    const results: SkillMatchResult[] = [];

    for (const skill of eligible) {
      // Only semantic-match skills that lack explicit matchers
      if (skill.triggerPrefix || skill.aliases?.length || skill.match) continue;

      const text = skill.whenToUse
        ? `${skill.description}. ${skill.whenToUse}`
        : skill.description;
      const skillEmbedding = await this.embeddingService.embedSingle(text);
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
