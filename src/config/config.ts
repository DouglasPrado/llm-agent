import { z } from 'zod';
import type { VectorStore, ConversationStore } from '../contracts/entities/stores.js';

/** MCP server connection configuration */
const MCPConnectionConfigSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(['stdio', 'sse', 'http', 'auto']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().url().optional(),
  headers: z.record(z.string()).optional(),
  timeout: z.number().positive().default(30_000),
  maxRetries: z.number().int().min(0).default(3),
  healthCheckInterval: z.number().positive().default(60_000),
  isolateErrors: z.boolean().default(true),
});

/** Cost policy — limits per execution and per session */
const CostPolicySchema = z.object({
  maxTokensPerExecution: z.number().positive().optional(),
  maxTokensPerSession: z.number().positive().optional(),
  maxToolCallsPerExecution: z.number().int().positive().default(50),
  onLimitReached: z.enum(['stop', 'warn']).default('stop'),
});

/** Memory subsystem configuration (file-based) */
const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  memoryDir: z.string().default('~/.agent/memory/'),
  relevanceModel: z.string().optional(),
  maxMemoryFiles: z.number().int().positive().default(200),
  extractionEnabled: z.boolean().default(true),
  samplingRate: z.number().min(0).max(1).default(0.3),
  extractionInterval: z.number().int().positive().default(10),
});

/** Knowledge/RAG subsystem configuration */
const KnowledgeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  store: z.custom<VectorStore>().optional(),
  chunkSize: z.number().int().positive().default(512),
  chunkOverlap: z.number().int().min(0).default(64),
  topK: z.number().int().positive().default(5),
  minScore: z.number().min(0).max(1).default(0.3),
});

/** Skills subsystem configuration */
const SkillsConfigSchema = z.object({
  skillsDir: z.string().optional(),
  maxActiveSkills: z.number().int().positive().default(3),
  modelDiscovery: z.boolean().default(true),
});

/** Embedding provider — allows separate API key/URL for embeddings */
const EmbeddingProviderConfigSchema = z.object({
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  model: z.string().optional(),
});

/** Full Agent configuration — validated with Zod */
export const AgentConfigSchema = z.object({
  apiKey: z.string().min(1, 'apiKey is required'),
  model: z.string().default('anthropic/claude-sonnet-4-20250514'),
  baseUrl: z.string().url().default('https://openrouter.ai/api/v1'),
  systemPrompt: z.string().optional(),

  // Subsystem configs
  memory: MemoryConfigSchema.optional(),
  knowledge: KnowledgeConfigSchema.optional(),
  skills: SkillsConfigSchema.optional(),
  costPolicy: CostPolicySchema.optional(),

  // Pluggable stores
  conversation: z.object({
    store: z.custom<ConversationStore>().optional(),
  }).optional(),

  // MCP
  mcp: z.array(MCPConnectionConfigSchema).optional(),

  // Behavior
  maxIterations: z.number().int().positive().default(10),
  maxConsecutiveErrors: z.number().int().positive().default(3),
  onToolError: z.enum(['continue', 'stop', 'retry']).default('continue'),

  // Context budget
  maxContextTokens: z.number().int().positive().default(128_000),
  maxPinnedMessages: z.number().int().positive().default(20),
  reserveTokens: z.number().int().min(0).default(4_096),

  // Compaction
  compactionThreshold: z.number().min(0).max(1).default(0.8),

  // Recovery
  fallbackModel: z.string().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  escalatedMaxOutputTokens: z.number().int().positive().optional(),

  // Token budget continuation
  tokenBudget: z.object({
    total: z.number().int().positive(),
    outputThreshold: z.number().min(0).max(1).default(0.5),
  }).optional(),

  // Observability
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  // Determinism (for testing)
  deterministic: z.boolean().default(false),
  seed: z.number().int().optional(),

  // Embedding model (for knowledge/RAG)
  embeddingModel: z.string().default('openai/text-embedding-3-small'),

  // Embedding provider (separate API key/URL for embeddings, e.g. direct OpenAI)
  embedding: EmbeddingProviderConfigSchema.optional(),

  // Database path
  dbPath: z.string().default('~/.agent/data.db'),
});

/** Input type before validation (allows partial/defaults) */
export type AgentConfigInput = z.input<typeof AgentConfigSchema>;

/** Validated config type */
export type AgentConfig = z.output<typeof AgentConfigSchema>;

export type MCPConnectionConfig = z.output<typeof MCPConnectionConfigSchema>;
export type MCPConnectionConfigInput = z.input<typeof MCPConnectionConfigSchema>;
export type CostPolicy = z.infer<typeof CostPolicySchema>;
