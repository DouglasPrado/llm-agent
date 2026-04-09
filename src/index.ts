// Agent (main entry point)
export { Agent } from './agent.js';
export type { ChatOptions } from './agent.js';

// Contracts (types and enums)
export * from './contracts/index.js';

// Config
export { AgentConfigSchema } from './config/config.js';
export type { AgentConfig, AgentConfigInput, MCPConnectionConfig, MCPConnectionConfigInput, CostPolicy } from './config/config.js';

// File-based memory system
export { FileMemorySystem } from './memory/file-memory-system.js';
export type { FileMemoryConfig } from './memory/file-memory-system.js';
export type { MemoryType, MemoryHeader, MemoryFile, SaveMemoryInput } from './memory/memory-types.js';

// Pluggable stores (for custom implementations)
export { SQLiteVectorStore } from './knowledge/sqlite-vector-store.js';
export { SQLiteConversationStore } from './storage/sqlite-conversation-store.js';
export { SQLiteDatabase } from './storage/sqlite-database.js';

// Builtin tools
export { builtinTools } from './tools/builtin/index.js';
export {
  createGlobTool, createGrepTool, createFileReadTool, createFileWriteTool,
  createFileEditTool, createBashTool, createWebFetchTool, createAskUserTool,
} from './tools/builtin/index.js';
export type { AskUserOptions } from './tools/builtin/index.js';

// JSON Schema → Zod
export { jsonSchemaToZod } from './tools/json-schema-to-zod.js';

// MCP
export { MCPAdapter } from './tools/mcp-adapter.js';
export type { MCPHealthStatus, MCPResource, MCPPromptInfo, MCPConnectionInfo } from './tools/mcp-adapter.js';

// Skills
export { SkillManager } from './skills/skill-manager.js';
export { createSkillTool, SKILL_TOOL_NAME } from './tools/skill-tool.js';
export { scanSkillFiles, loadSkillFile, parseSkillFrontmatter } from './skills/skill-loader.js';
export { substituteArgs } from './skills/skill-args.js';
export { matchGlob, matchAnyGlob } from './skills/skill-glob.js';

// Turn-end hooks
export { runTurnEndHooks } from './core/turn-end-hooks.js';
export type { TurnEndHook, TurnEndHookContext, TurnEndHookResult } from './core/turn-end-hooks.js';

// Prompt builders
export { buildToolUsagePrompt, buildEnvironmentPrompt } from './core/prompt-builders.js';
export type { EnvironmentInfo } from './core/prompt-builders.js';

// Message normalization
export { normalizeMessagesForAPI } from './core/message-normalize.js';

// Prompt cache
export { PromptSectionCache } from './core/prompt-cache.js';

// Context analysis
export { analyzeContext } from './core/context-analysis.js';
export type { ContextAnalysis } from './core/context-analysis.js';

// Model utilities
export { getModelContextWindow } from './utils/model-context.js';

// Utils
export { createLogger } from './utils/logger.js';
export type { Logger } from './utils/logger.js';
export { LRUCache } from './utils/cache.js';
export { retry } from './utils/retry.js';
export { estimateTokens } from './utils/token-counter.js';
