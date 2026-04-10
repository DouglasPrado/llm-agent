import type { AgentTool } from './agent-tool.js';

/** A skill that modifies Agent behavior when activated */
export interface AgentSkill {
  // --- Core (required) ---
  name: string;
  description: string;
  instructions: string;

  // --- Matching ---
  /** Custom predicate for pattern-based activation */
  match?: (input: string, context: SkillMatchContext) => boolean;
  /** Exact prefix match (e.g. "/review") */
  triggerPrefix?: string;
  /** Alternative names for slash-command invocation */
  aliases?: string[];
  /** Higher number = higher priority when multiple skills match */
  priority?: number;
  /** If true, blocks all other skills when activated */
  exclusive?: boolean;

  // --- Prompt generation ---
  /** Dynamic prompt generator — when provided, overrides static `instructions` */
  getPrompt?: (args: string, context: SkillPromptContext) => Promise<string> | string;
  /** Named argument placeholders for substitution ($argName in instructions) */
  argNames?: string[];
  /** Detailed usage scenarios — helps model decide WHEN to invoke proactively */
  whenToUse?: string;

  // --- Execution ---
  /** Tools available only when this skill is active */
  tools?: AgentTool[];
  /** Restrict which global tools the skill can use (allowlist) */
  allowedTools?: string[];
  /** Override model for this skill's execution */
  model?: string;
  /** Execution mode: 'inline' injects into current context */
  context?: 'inline';
  /** Computational effort hint (1-10) */
  effort?: number;

  // --- Session persistence ---
  /** Keeps the skill active across subsequent turns after initial activation.
   *  true = active until clearStickySkills() is called (e.g. on clearHistory).
   *  number = number of additional turns to remain active after activation (e.g. 10). */
  sticky?: boolean | number;

  // --- Activation ---
  /** Glob patterns — skill only activates when matching files are touched */
  paths?: string[];
  /** Feature-flag function — skill hidden when returns false */
  isEnabled?: () => boolean;
  /** Whether model can invoke this skill proactively (default: true) */
  modelInvocable?: boolean;

  // --- Metadata ---
  /** Source of the skill (for diagnostics/listing) */
  source?: 'programmatic' | 'directory' | 'mcp' | 'bundled';
  /** Base directory for skill resources (set automatically for .md skills) */
  skillDir?: string;
}

/** Context passed to skill.match() */
export interface SkillMatchContext {
  threadId: string;
  recentMessages: number;
}

/** Context passed to skill.getPrompt() */
export interface SkillPromptContext {
  threadId: string;
  traceId: string;
  skillDir?: string;
}
