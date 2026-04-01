import type { AgentConfig, AgentConfigInput } from './config/config.js';
import { AgentConfigSchema } from './config/config.js';
import type { AgentEvent } from './contracts/entities/agent-event.js';
import type { AgentTool } from './contracts/entities/agent-tool.js';
import type { AgentSkill } from './contracts/entities/agent-skill.js';
import type { Memory } from './contracts/entities/memory.js';
import type { KnowledgeDocument } from './contracts/entities/knowledge.js';
import type { TokenUsage } from './contracts/entities/token-usage.js';
import type { ContentPart } from './contracts/entities/content-part.js';
import type { ContextInjection } from './core/context-builder.js';
import { OpenRouterClient } from './llm/openrouter-client.js';
import { ToolExecutor } from './tools/tool-executor.js';
import { SkillManager } from './skills/skill-manager.js';
import { MemoryManager } from './memory/memory-manager.js';
import { KnowledgeManager } from './knowledge/knowledge-manager.js';
import { EmbeddingService } from './knowledge/embedding-service.js';
import { SQLiteDatabase } from './storage/sqlite-database.js';
import { SQLiteMemoryStore } from './memory/sqlite-memory-store.js';
import { SQLiteVectorStore } from './knowledge/sqlite-vector-store.js';
import { ConversationManager } from './core/conversation-manager.js';
import { StreamEmitter } from './core/stream-emitter.js';
import { createExecutionContext } from './core/execution-context.js';
import { buildContext } from './core/context-builder.js';
import { executeReactLoop } from './core/react-loop.js';
import { createLogger, type Logger } from './utils/logger.js';
import { estimateTokens } from './utils/token-counter.js';

export interface ChatOptions {
  threadId?: string;
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * Main entry point — orchestrates all subsystems.
 */
export class Agent {
  private readonly config: AgentConfig;
  private readonly client: OpenRouterClient;
  private readonly toolExecutor: ToolExecutor;
  private readonly conversations: ConversationManager;
  private readonly logger: Logger;
  private readonly skillManager?: SkillManager;
  private readonly memoryManager?: MemoryManager;
  private readonly knowledgeManager?: KnowledgeManager;
  private readonly embeddingService?: EmbeddingService;
  private database?: SQLiteDatabase;
  private costAccumulator: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  private destroyed = false;

  private constructor(config: AgentConfig) {
    this.config = config;
    this.logger = createLogger({ level: config.logLevel });

    this.client = new OpenRouterClient({
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
    });

    this.toolExecutor = new ToolExecutor();

    // Conversation store
    if (config.conversation?.store) {
      this.conversations = new ConversationManager(config.conversation.store);
    } else {
      this.conversations = new ConversationManager();
    }

    // Embedding service (shared by memory + knowledge)
    this.embeddingService = new EmbeddingService(this.client, { model: config.embeddingModel });

    // Memory subsystem
    if (config.memory?.enabled !== false) {
      const memoryStore = config.memory?.store ?? this.getDefaultMemoryStore();
      this.memoryManager = new MemoryManager({
        store: memoryStore,
        decayFactor: config.memory?.decayFactor,
        decayInterval: config.memory?.decayInterval,
        minConfidence: config.memory?.minConfidence,
        samplingRate: config.memory?.samplingRate,
      });
    }

    // Knowledge subsystem
    if (config.knowledge?.enabled !== false) {
      const vectorStore = config.knowledge?.store ?? this.getDefaultVectorStore();
      this.knowledgeManager = new KnowledgeManager({
        store: vectorStore,
        embeddingService: this.embeddingService,
        chunkSize: config.knowledge?.chunkSize,
        chunkOverlap: config.knowledge?.chunkOverlap,
        topK: config.knowledge?.topK,
        minScore: config.knowledge?.minScore,
      });
    }

    // Skills
    this.skillManager = new SkillManager({ embeddingService: this.embeddingService });

    this.logger.info('Agent initialized', { model: config.model });
  }

  /**
   * Creates and validates an Agent instance.
   */
  static create(input: AgentConfigInput): Agent {
    const config = AgentConfigSchema.parse(input);
    return new Agent(config);
  }

  /**
   * Streaming API — primary interface. Returns AsyncIterableIterator<AgentEvent>.
   */
  async *stream(input: string | ContentPart[], options?: ChatOptions): AsyncIterableIterator<AgentEvent> {
    if (this.destroyed) throw new Error('Agent is destroyed');

    const threadId = options?.threadId ?? 'default';
    const model = options?.model ?? this.config.model;
    const ctx = createExecutionContext(threadId, model);

    yield* await this.conversations.withThread(threadId, async () => {
      const emitter = new StreamEmitter();
      const iter = emitter.iterator();

      // Add user message
      const userContent = typeof input === 'string' ? input : input.map(p => p.type === 'text' ? p.text : '[image]').join('');
      this.conversations.appendMessage({
        role: 'user',
        content: input,
        createdAt: Date.now(),
      }, threadId);

      // Build context
      const injections = await this.buildInjections(userContent, threadId);
      const history = this.conversations.getHistory(threadId);
      const contextResult = buildContext({
        systemPrompt: this.config.systemPrompt,
        injections,
        history,
        maxTokens: this.config.maxContextTokens,
        reserveTokens: this.config.reserveTokens,
        maxPinnedMessages: this.config.maxPinnedMessages,
      });

      // Emit start
      emitter.emit({ type: 'agent_start', traceId: ctx.traceId, threadId, model });

      // Run react loop in background
      const loopPromise = executeReactLoop(contextResult.messages, {
        client: this.client,
        toolExecutor: this.toolExecutor,
        emitter,
        model,
        maxIterations: this.config.maxIterations,
        maxConsecutiveErrors: this.config.maxConsecutiveErrors,
        onToolError: this.config.onToolError,
        costPolicy: this.config.costPolicy ? {
          maxTokensPerExecution: this.config.costPolicy.maxTokensPerExecution,
          onLimitReached: this.config.costPolicy.onLimitReached,
        } : undefined,
        signal: options?.signal,
      }).then(result => {
        // Accumulate cost
        this.costAccumulator.inputTokens += result.usage.inputTokens;
        this.costAccumulator.outputTokens += result.usage.outputTokens;
        this.costAccumulator.totalTokens += result.usage.totalTokens;

        // Emit end
        emitter.emit({
          type: 'agent_end',
          traceId: ctx.traceId,
          usage: result.usage,
          reason: result.reason as AgentEvent extends { type: 'agent_end' } ? AgentEvent : never extends never ? never : 'stop',
          duration: Date.now() - ctx.startedAt,
        });

        emitter.close();
        return result;
      }).catch(error => {
        emitter.emit({ type: 'error', error: error instanceof Error ? error : new Error(String(error)), recoverable: false });
        emitter.close();
      });

      // Memory extraction (fire and forget after loop)
      void loopPromise.then(() => {
        if (this.memoryManager?.shouldExtract(userContent)) {
          this.memoryManager.resetExtractionCounter();
          // In a real impl, this would call the LLM to extract memories
        }
      });

      return iter;
    });
  }

  /**
   * Simple chat API — consumes stream() and returns final text.
   */
  async chat(input: string | ContentPart[], options?: ChatOptions): Promise<string> {
    let result = '';
    for await (const event of this.stream(input, options)) {
      if (event.type === 'text_delta') result += event.content;
      if (event.type === 'error' && !event.recoverable) throw event.error;
    }
    return result;
  }

  addTool(tool: AgentTool): void {
    this.toolExecutor.register(tool);
    this.logger.debug('Tool registered', { name: tool.name });
  }

  addSkill(skill: AgentSkill): void {
    this.skillManager?.register(skill);
    this.logger.debug('Skill registered', { name: skill.name });
  }

  async remember(content: string, scope?: 'thread' | 'persistent' | 'learned'): Promise<Memory> {
    if (!this.memoryManager) throw new Error('Memory subsystem not enabled');
    return this.memoryManager.saveExplicit(content, scope);
  }

  async recall(query: string): Promise<Memory[]> {
    if (!this.memoryManager) throw new Error('Memory subsystem not enabled');
    return this.memoryManager.recall(query);
  }

  async ingestKnowledge(document: KnowledgeDocument): Promise<void> {
    if (!this.knowledgeManager) throw new Error('Knowledge subsystem not enabled');
    const chunks = await this.knowledgeManager.ingest(document);
    this.logger.info('Knowledge ingested', { chunks });
  }

  getUsage(): TokenUsage {
    return { ...this.costAccumulator };
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.database?.close();
    this.logger.info('Agent destroyed');
  }

  private getDefaultMemoryStore() {
    this.ensureDatabase();
    return new SQLiteMemoryStore(this.database!);
  }

  private getDefaultVectorStore() {
    this.ensureDatabase();
    return new SQLiteVectorStore(this.database!);
  }

  private ensureDatabase(): void {
    if (!this.database) {
      this.database = new SQLiteDatabase(this.config.dbPath === '~/.agent/data.db' ? ':memory:' : this.config.dbPath);
      this.database.initialize();
    }
  }

  private async buildInjections(userInput: string, threadId: string): Promise<ContextInjection[]> {
    const injections: ContextInjection[] = [];

    // Skills injection
    if (this.skillManager) {
      const matchedSkills = await this.skillManager.match(userInput, { threadId });
      for (const skill of matchedSkills) {
        const tokens = estimateTokens(skill.instructions);
        injections.push({ source: `skill:${skill.name}`, priority: 8, content: skill.instructions, tokens });
      }
    }

    // Knowledge injection
    if (this.knowledgeManager) {
      try {
        const results = await this.knowledgeManager.search(userInput);
        if (results.length > 0) {
          const content = results.map(r => r.content).join('\n\n');
          const tokens = estimateTokens(content);
          injections.push({ source: 'knowledge', priority: 6, content: `Relevant knowledge:\n${content}`, tokens });
        }
      } catch {
        // Knowledge search failed — continue without it
      }
    }

    // Memory injection
    if (this.memoryManager) {
      try {
        const memories = this.memoryManager.recall(userInput, { threadId, limit: 5 });
        if (memories.length > 0) {
          const content = memories.map(m => `- ${m.content}`).join('\n');
          const tokens = estimateTokens(content);
          injections.push({ source: 'memory', priority: 4, content: `Relevant memories:\n${content}`, tokens });
        }
      } catch {
        // Memory recall failed — continue without it
      }
    }

    return injections;
  }
}
