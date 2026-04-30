import type { AgentConfig, AgentConfigInput, MCPConnectionConfigInput } from './config/config.js';
import { AgentConfigSchema } from './config/config.js';
import type { AgentEvent, AgentEndEvent } from './contracts/entities/agent-event.js';
import type { AgentTool } from './contracts/entities/agent-tool.js';
import type { AgentSkill } from './contracts/entities/agent-skill.js';
import type { KnowledgeDocument, RetrievedKnowledge } from './contracts/entities/knowledge.js';
import type { TokenUsage } from './contracts/entities/token-usage.js';
import type { ContentPart } from './contracts/entities/content-part.js';
import type { MessageRole } from './contracts/enums/index.js';
import type { ContextInjection } from './core/context-builder.js';
import type { Terminal } from './core/loop-types.js';
import { LLMClient } from './llm/llm-client.js';
import { ToolExecutor } from './tools/tool-executor.js';
import { MCPAdapter, type MCPHealthStatus } from './tools/mcp-adapter.js';
import { SkillManager } from './skills/skill-manager.js';
import { createSkillTool, SKILL_TOOL_NAME, buildSkillToolPrompt } from './tools/skill-tool.js';
import { FileMemorySystem } from './memory/file-memory-system.js';
import { validateThreadId } from './memory/memory-paths.js';
import { extractMemories, shouldExtract } from './memory/memory-extractor.js';
import { memoryFreshnessNote } from './memory/memory-age.js';
import { KnowledgeManager } from './knowledge/knowledge-manager.js';
import { EmbeddingService } from './knowledge/embedding-service.js';
import { SQLiteDatabase } from './storage/sqlite-database.js';
import { SQLiteVectorStore } from './knowledge/sqlite-vector-store.js';
import { SQLiteConversationStore } from './storage/sqlite-conversation-store.js';
import { ConversationManager } from './core/conversation-manager.js';
import { createExecutionContext } from './core/execution-context.js';
import { buildContext } from './core/context-builder.js';
import { executeReactLoop } from './core/react-loop.js';
import { createLogger, type Logger } from './utils/logger.js';
import { runTurnEndHooks, type TurnEndHook } from './core/turn-end-hooks.js';
import { estimateTokens } from './utils/token-counter.js';
import { getModelContextWindow } from './utils/model-context.js';
import { buildToolUsagePrompt, buildEnvironmentPrompt } from './core/prompt-builders.js';
import { homedir } from 'node:os';

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
  private readonly client: LLMClient;
  private readonly toolExecutor: ToolExecutor;
  private readonly conversations: ConversationManager;
  private readonly logger: Logger;
  private readonly skillManager?: SkillManager;
  private readonly fileMemorySystem?: FileMemorySystem;
  private readonly knowledgeManager?: KnowledgeManager;
  private readonly embeddingService?: EmbeddingService;
  private readonly mcpAdapter: MCPAdapter;
  private database?: SQLiteDatabase;
  private costAccumulator: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  private turnsSinceExtraction = 0;
  private destroyed = false;
  /** Filenames already injected in this session — avoids re-surfacing the same memory. */
  private surfacedMemories = new Set<string>();
  /** Last date emitted to model — for midnight change detection. */
  private lastEmittedDate?: string;
  /** Turn-end hooks — run after each completed assistant turn. */
  private readonly turnEndHooks: TurnEndHook[] = [];

  private constructor(config: AgentConfig) {
    this.config = config;
    this.logger = createLogger({ level: config.logLevel });

    this.client = new LLMClient({
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
    });

    this.toolExecutor = new ToolExecutor();
    this.mcpAdapter = new MCPAdapter(this.toolExecutor);

    // Conversation store — defaults to SQLite when database is available (persists across restarts)
    if (config.conversation?.store) {
      this.conversations = new ConversationManager(config.conversation.store);
    } else if (config.knowledge?.enabled !== false) {
      // Database will be initialized for knowledge, reuse it for conversations
      this.conversations = new ConversationManager(this.getDefaultConversationStore());
    } else {
      this.conversations = new ConversationManager();
    }

    // Embedding service — optionally uses a separate provider (e.g. direct OpenAI)
    const embApiKey = config.embedding?.apiKey ?? config.apiKey;
    const embBaseUrl = config.embedding?.baseUrl ?? config.baseUrl;
    const embModel = config.embedding?.model ?? config.embeddingModel;
    const embeddingClient = (embApiKey !== config.apiKey || embBaseUrl !== config.baseUrl)
      ? new LLMClient({ apiKey: embApiKey, model: embModel, baseUrl: embBaseUrl })
      : this.client;
    this.embeddingService = new EmbeddingService(embeddingClient, { model: embModel });

    // Memory subsystem (file-based)
    if (config.memory?.enabled !== false) {
      this.fileMemorySystem = new FileMemorySystem(
        {
          memoryDir: config.memory?.memoryDir,
          relevanceModel: config.memory?.relevanceModel,
          extractionEnabled: config.memory?.extractionEnabled,
        },
        this.client,
        this.logger,
      );
      // Ensure memory directory exists (fire-and-forget)
      void this.fileMemorySystem.ensureDir().catch(err => {
        this.logger.warn('Memory directory initialization failed — persistent memory disabled', {
          memoryDir: config.memory?.memoryDir,
          error: String(err),
        });
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
    this.skillManager = new SkillManager({
      embeddingService: this.embeddingService,
      maxActiveSkills: config.skills?.maxActiveSkills,
    });

    // Auto-load skills from directory (fire-and-forget)
    if (config.skills?.skillsDir) {
      void this.skillManager.loadFromDirectory(config.skills.skillsDir).catch(err => {
        this.logger.warn('Skills directory loading failed — skills unavailable', {
          skillsDir: config.skills.skillsDir,
          error: String(err),
        });
      });
    }

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
   * Uses AsyncGenerator pattern: the react loop yields events directly.
   */
  async *stream(input: string | ContentPart[], options?: ChatOptions): AsyncIterableIterator<AgentEvent> {
    if (this.destroyed) throw new Error('Agent is destroyed');

    const threadId = options?.threadId ?? 'default';
    if (!validateThreadId(threadId)) throw new Error(`Invalid threadId: ${JSON.stringify(threadId)}`);
    const model = options?.model ?? this.config.model;
    const ctx = createExecutionContext(threadId, model);

    // Add user message
    const userContent = typeof input === 'string' ? input : input.map(p => p.type === 'text' ? p.text : '[image]').join('');
    await this.conversations.withThread(threadId, async () => {
      this.conversations.appendMessage({
        role: 'user',
        content: input,
        createdAt: Date.now(),
      }, threadId);
    });

    // Start memory relevance prefetch (non-blocking, thread-scoped)
    const memoryPrefetch = this.fileMemorySystem
      ? this.startMemoryPrefetch(userContent, threadId)
      : undefined;

    // Build context (memory prefetch resolves in parallel)
    const { injections, skillToolNames } = await this.buildInjectionsWithSkills(userContent, threadId, memoryPrefetch);

    // Register SkillTool so the model can invoke skills mid-loop
    let skillToolRegistered = false;
    if (this.skillManager && this.skillManager.listSkills().length > 0) {
      const skillTool = createSkillTool(this.skillManager, this.toolExecutor, () => ({
        threadId,
        traceId: ctx.traceId,
      }));
      this.toolExecutor.register(skillTool);
      skillToolRegistered = true;
    }

    const availableTools = this.toolExecutor.listTools();
    if (availableTools.length > 0) {
      const toolContent = buildToolUsagePrompt(availableTools);
      injections.push({
        source: 'tools',
        priority: 10,
        content: toolContent,
        tokens: estimateTokens(toolContent),
      });
    }

    // Environment info — gives model awareness of execution context
    const today = new Date().toISOString().split('T')[0]!;
    const envContent = buildEnvironmentPrompt({
      model,
      date: today,
      platform: process.platform,
    });
    injections.push({
      source: 'environment',
      priority: 1,
      content: envContent,
      tokens: estimateTokens(envContent),
    });

    // Date change detection — notify model when day changes mid-session
    if (this.lastEmittedDate && this.lastEmittedDate !== today) {
      injections.push({
        source: 'system:date_change',
        priority: 10,
        content: `The date has changed from ${this.lastEmittedDate} to ${today}.`,
        tokens: 20,
      });
    }
    this.lastEmittedDate = today;

    const history = this.conversations.getHistory(threadId);
    const contextResult = buildContext({
      systemPrompt: this.config.systemPrompt,
      injections,
      history,
      maxTokens: this.config.maxContextTokens,
      reserveTokens: this.config.reserveTokens,
      maxPinnedMessages: this.config.maxPinnedMessages,
    });

    if (contextResult.droppedPinnedCount > 0) {
      this.logger.warn('Pinned messages dropped due to context budget', {
        dropped: contextResult.droppedPinnedCount,
        totalTokens: contextResult.totalTokens,
        maxTokens: this.config.maxContextTokens,
      });
    }

    // Snapshot memory dir time for mutual exclusion with extraction
    const turnStartMs = Date.now();

    // Emit start
    yield { type: 'agent_start', traceId: ctx.traceId, threadId, model };

    // Emit skill_activated events for matched skills
    for (const inj of injections.filter(i => i.source.startsWith('skill:') && i.source !== 'skill:listing')) {
      yield { type: 'skill_activated', skillName: inj.source.replace('skill:', '') };
    }

    // Intercept events from the generator for persistence tracking
    let assistantText = '';
    const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    const pendingToolResults: Array<{ toolCallId: string; content: string }> = [];

    const loopGen = executeReactLoop(contextResult.messages, {
      client: this.client,
      toolExecutor: this.toolExecutor,
      model,
      maxIterations: this.config.maxIterations,
      maxConsecutiveErrors: this.config.maxConsecutiveErrors,
      onToolError: this.config.onToolError,
      costPolicy: this.config.costPolicy ? {
        maxTokensPerExecution: this.config.costPolicy.maxTokensPerExecution,
        onLimitReached: this.config.costPolicy.onLimitReached,
      } : undefined,
      signal: options?.signal,
      // Compaction & Recovery
      maxContextTokens: this.config.maxContextTokens,
      compactionThreshold: this.config.compactionThreshold,
      fallbackModel: this.config.fallbackModel,
      maxOutputTokens: this.config.maxOutputTokens,
      escalatedMaxOutputTokens: this.config.escalatedMaxOutputTokens,
      // Token budget
      tokenBudget: this.config.tokenBudget,
      // Tool intelligence: conditional skill activation from file operations
      onFilePathsTouched: this.skillManager
        ? (paths) => this.skillManager!.activateForPaths(paths)
        : undefined,
    });

    // Consume the generator, intercept events, re-yield to consumer
    let terminal: Terminal;
    try {
      let result = await loopGen.next();
      while (!result.done) {
        const event = result.value;

        // Track for persistence
        if (event.type === 'text_delta') assistantText += event.content;
        if (event.type === 'tool_call_start') {
          pendingToolCalls.push({
            id: event.toolCall.id,
            name: event.toolCall.function.name,
            arguments: event.toolCall.function.arguments,
          });
        }
        if (event.type === 'tool_call_end') {
          pendingToolResults.push({
            toolCallId: event.toolCallId,
            content: event.result.content,
          });
        }

        yield event;
        result = await loopGen.next();
      }
      terminal = result.value;
    } catch (error) {
      // Persist partial text on unexpected error
      if (assistantText) {
        this.conversations.appendMessage({
          role: 'assistant',
          content: assistantText,
          createdAt: Date.now(),
        }, threadId);
      }
      yield { type: 'error', error: error instanceof Error ? error : new Error(String(error)), recoverable: false };
      yield {
        type: 'agent_end',
        traceId: ctx.traceId,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        reason: 'error' as const,
        duration: Date.now() - ctx.startedAt,
      };
      return;
    }

    // --- Post-loop: persist conversation history ---
    const now = Date.now();

    if (pendingToolCalls.length > 0) {
      this.conversations.appendMessage({
        role: 'assistant',
        content: '',
        toolCalls: pendingToolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
        createdAt: now - 2,
      }, threadId);

      for (const tr of pendingToolResults) {
        const isSkillTool = pendingToolCalls.some(tc => tc.id === tr.toolCallId && tc.name === SKILL_TOOL_NAME);
        this.conversations.appendMessage({
          role: 'tool' as MessageRole,
          content: tr.content,
          toolCallId: tr.toolCallId,
          pinned: isSkillTool || undefined,
          createdAt: now - 1,
        }, threadId);
      }
    }

    if (assistantText) {
      this.conversations.appendMessage({
        role: 'assistant',
        content: assistantText,
        createdAt: now,
      }, threadId);
    }

    // Accumulate cost
    this.costAccumulator.inputTokens += terminal.usage.inputTokens;
    this.costAccumulator.outputTokens += terminal.usage.outputTokens;
    this.costAccumulator.totalTokens += terminal.usage.totalTokens;

    // Cleanup skill-scoped tools and SkillTool
    for (const name of skillToolNames) {
      this.toolExecutor.unregister(name);
    }
    if (skillToolRegistered) {
      this.toolExecutor.unregister(SKILL_TOOL_NAME);
    }

    // Emit end
    yield {
      type: 'agent_end',
      traceId: ctx.traceId,
      usage: terminal.usage,
      reason: terminal.reason as AgentEndEvent['reason'],
      duration: Date.now() - ctx.startedAt,
    };

    // Turn-end hooks pipeline (memory extraction + custom hooks)
    const turnEndContext = {
      assistantText,
      turnCount: 1,
      threadId,
      usage: terminal.usage,
    };

    // Built-in: memory extraction hook
    this.turnsSinceExtraction++;
    if (
      this.fileMemorySystem &&
      this.config.memory?.extractionEnabled !== false &&
      shouldExtract(userContent, this.turnsSinceExtraction, {
        samplingRate: this.config.memory?.samplingRate,
        extractionInterval: this.config.memory?.extractionInterval,
      })
    ) {
      this.turnsSinceExtraction = 0;
      const memSystem = this.fileMemorySystem;
      const logger = this.logger;
      const conversations = this.conversations;
      const forkFn = this.fork.bind(this);

      void (async () => {
        try {
          if (await memSystem.hasWritesSince(turnStartMs, threadId)) {
            logger.debug('Skipping extraction — agent already wrote memories this turn');
            return;
          }
          const history = conversations.getHistory(threadId);
          const recentMessages = history.slice(-10);
          const conversationText = recentMessages.map(m => {
            const text = typeof m.content === 'string' ? m.content : '[multimodal]';
            return `${m.role}: ${text}`;
          }).join('\n');
          await extractMemories(conversationText, memSystem, forkFn, { threadId, logger });
        } catch (err) {
          logger.debug('Memory extraction failed', { error: String(err) });
        }
      })();
    }

    // Run registered turn-end hooks
    if (this.turnEndHooks.length > 0) {
      void runTurnEndHooks(this.turnEndHooks, turnEndContext).catch(err => {
        this.logger.debug('Turn-end hooks failed', { error: String(err) });
      });
    }
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

  removeTool(name: string): boolean {
    const removed = this.toolExecutor.unregister(name);
    if (removed) this.logger.debug('Tool removed', { name });
    return removed;
  }

  addSkill(skill: AgentSkill): void {
    this.skillManager?.register(skill);
    this.logger.debug('Skill registered', { name: skill.name });
  }

  removeSkill(name: string): boolean {
    const removed = this.skillManager?.unregister(name) ?? false;
    if (removed) this.logger.debug('Skill removed', { name });
    return removed;
  }

  /** Load skills from a directory containing SKILL.md files. Returns count loaded. */
  async loadSkillsDir(dir: string): Promise<number> {
    if (!this.skillManager) return 0;
    const count = await this.skillManager.loadFromDirectory(dir);
    this.logger.info('Skills loaded from directory', { dir, count });
    return count;
  }

  /** Get all registered skills (unconditional + activated). */
  listSkills(): AgentSkill[] {
    return this.skillManager?.listSkills() ?? [];
  }

  /** Activate conditional skills whose paths match the given file paths. */
  activateSkillsForPaths(filePaths: string[]): string[] {
    return this.skillManager?.activateForPaths(filePaths) ?? [];
  }

  /** Register a hook that runs after each completed assistant turn. */
  addTurnEndHook(hook: TurnEndHook): void {
    this.turnEndHooks.push(hook);
    this.logger.debug('Turn-end hook registered', { name: hook.name });
  }

  /**
   * Fork a child agent that inherits parent config.
   * Runs a single chat() call in isolation and returns the result.
   * Ported from old_src/utils/forkedAgent.ts pattern.
   */
  async fork(
    prompt: string,
    options?: {
      systemPrompt?: string;
      model?: string;
      /** Tools available to the forked agent. If omitted, fork has no tools. */
      tools?: import('./contracts/entities/agent-tool.js').AgentTool[];
      /** If true, runs in background and returns a Promise (fire-and-forget). Default: false (blocking). */
      background?: boolean;
    },
  ): Promise<string> {
    if (this.destroyed) throw new Error('Agent is destroyed');

    const run = async () => {
      const child = Agent.create({
        apiKey: this.config.apiKey,
        model: options?.model ?? this.config.model,
        baseUrl: this.config.baseUrl,
        systemPrompt: options?.systemPrompt ?? this.config.systemPrompt,
        memory: { enabled: false },
        knowledge: { enabled: false },
        maxIterations: this.config.maxIterations,
        maxConsecutiveErrors: this.config.maxConsecutiveErrors,
        onToolError: this.config.onToolError,
        logLevel: this.config.logLevel,
      });

      if (options?.tools) {
        for (const tool of options.tools) {
          child.addTool(tool);
        }
      }

      try {
        return await child.chat(prompt);
      } finally {
        await child.destroy();
      }
    };

    if (options?.background) {
      void run().catch(err => {
        this.logger.debug('Background fork failed', { error: String(err) });
      });
      return ''; // fire-and-forget — returns immediately
    }

    return run();
  }

  /** Get effective context window for the current model. */
  getEffectiveContextWindow(): number {
    return getModelContextWindow(this.config.model, this.config.maxContextTokens);
  }

  getHistory(threadId?: string): import('./contracts/entities/chat-message.js').ChatMessage[] {
    return this.conversations.getHistory(threadId ?? 'default');
  }

  clearHistory(threadId?: string): void {
    const tid = threadId ?? 'default';
    this.conversations.clearThread(tid);
    this.skillManager?.clearStickySkills(tid);
    // Prevent unbounded growth of the surfaced-memory set across long sessions.
    this.surfacedMemories.clear();
    this.logger.info('Thread cleared', { threadId: tid });
  }

  async connectMCP(config: MCPConnectionConfigInput): Promise<void> {
    // Apply defaults (timeout, maxRetries, etc.)
    const parsed = {
      ...config,
      timeout: config.timeout ?? 30_000,
      maxRetries: config.maxRetries ?? 3,
      healthCheckInterval: config.healthCheckInterval ?? 60_000,
      isolateErrors: config.isolateErrors ?? true,
    };
    const tools = await this.mcpAdapter.connect(parsed);
    this.logger.info('MCP connected', { name: config.name, tools: tools.length });

    // Register MCP prompts as skills
    if (this.skillManager) {
      for (const [name, prompt] of this.mcpAdapter.getPrompts()) {
        const adapter = this.mcpAdapter;
        this.skillManager.register({
          name,
          description: prompt.description ?? prompt.promptName,
          instructions: '',
          source: 'mcp',
          getPrompt: async (args) => adapter.getPrompt(prompt.serverName, prompt.promptName, args),
        });
      }
    }
  }

  async disconnectMCP(name: string): Promise<void> {
    await this.mcpAdapter.disconnect(name);
    this.logger.info('MCP disconnected', { name });
  }

  getHealth(): MCPHealthStatus {
    return this.mcpAdapter.getHealth();
  }

  async remember(content: string, type: 'user' | 'feedback' | 'project' | 'reference' = 'user', threadId?: string): Promise<string> {
    if (!this.fileMemorySystem) throw new Error('Memory subsystem not enabled');
    const name = content.slice(0, 40).replace(/[^a-zA-Z0-9\s]/g, '').trim();
    return this.fileMemorySystem.saveMemory({
      name: name || 'memory',
      description: content.slice(0, 100),
      type,
      content,
    }, threadId);
  }

  async recall(query: string, threadId?: string): Promise<import('./memory/memory-types.js').MemoryFile[]> {
    if (!this.fileMemorySystem) throw new Error('Memory subsystem not enabled');
    return this.fileMemorySystem.findRelevant(query, undefined, undefined, threadId);
  }

  async ingestKnowledge(document: KnowledgeDocument): Promise<void> {
    if (!this.knowledgeManager) throw new Error('Knowledge subsystem not enabled');
    const chunks = await this.knowledgeManager.ingest(document);
    this.logger.info('Knowledge ingested', { chunks });
  }

  async searchKnowledge(query: string): Promise<RetrievedKnowledge[]> {
    if (!this.knowledgeManager) throw new Error('Knowledge subsystem not enabled');
    return this.knowledgeManager.search(query);
  }

  getUsage(): TokenUsage {
    return { ...this.costAccumulator };
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.skillManager?.clearAllStickySessions();
    this.skillManager?.clearInvokedSkills();
    this.surfacedMemories.clear();
    await this.mcpAdapter.disconnectAll();
    this.database?.close();
    this.logger.info('Agent destroyed');
  }

  private getDefaultConversationStore() {
    this.ensureDatabase();
    return new SQLiteConversationStore(this.database!);
  }

  private getDefaultVectorStore() {
    this.ensureDatabase();
    return new SQLiteVectorStore(this.database!);
  }

  private ensureDatabase(): void {
    if (!this.database) {
      // Expand ~ to home directory
      let dbPath = this.config.dbPath;
      if (dbPath === '~' || dbPath.startsWith('~/')) {
        dbPath = homedir() + dbPath.slice(1);
      }
      this.database = new SQLiteDatabase(dbPath);
      this.database.initialize();
    }
  }

  /** Timeout for memory relevance prefetch (ms). */
  private static readonly MEMORY_PREFETCH_TIMEOUT = 5_000;

  /**
   * Start memory relevance selection asynchronously.
   * Returns a promise that resolves with relevant MemoryFiles.
   * Races against a timeout so it never blocks the response indefinitely.
   */
  private startMemoryPrefetch(
    userInput: string,
    threadId?: string,
  ): Promise<import('./memory/memory-types.js').MemoryFile[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Agent.MEMORY_PREFETCH_TIMEOUT);

    return this.fileMemorySystem!
      .findRelevant(userInput, controller.signal, this.surfacedMemories, threadId)
      .catch(() => [] as import('./memory/memory-types.js').MemoryFile[])
      .finally(() => clearTimeout(timeout));
  }

  private async buildInjectionsWithSkills(
    userInput: string,
    threadId: string,
    memoryPrefetch?: Promise<import('./memory/memory-types.js').MemoryFile[]>,
  ): Promise<{ injections: ContextInjection[]; skillToolNames: string[] }> {
    const injections: ContextInjection[] = [];

    // Skills injection
    const skillToolNames: string[] = [];
    if (this.skillManager) {
      const matchedSkills = await this.skillManager.match(userInput, { threadId });

      for (const skill of matchedSkills) {
        // Resolve instructions (dynamic getPrompt or static with arg substitution)
        const rawArgs = skill.triggerPrefix && userInput.startsWith(skill.triggerPrefix)
          ? userInput.slice(skill.triggerPrefix.length).trim()
          : skill.aliases?.reduce((acc, alias) => {
              const prefix = alias.startsWith('/') ? alias : `/${alias}`;
              return userInput.startsWith(prefix) ? userInput.slice(prefix.length).trim() : acc;
            }, '')
          ?? '';

        const resolved = await this.skillManager.resolveInstructions(skill, rawArgs, {
          threadId,
          traceId: 'pending', // traceId not yet available at injection time
          skillDir: skill.skillDir,
        });

        const tokens = estimateTokens(resolved);
        injections.push({ source: `skill:${skill.name}`, priority: 8, content: resolved, tokens });

        // Register skill-scoped tools
        if (skill.tools?.length) {
          for (const tool of skill.tools) {
            this.toolExecutor.register(tool);
            skillToolNames.push(tool.name);
          }
        }

        // Track invocation
        this.skillManager.markInvoked(skill.name);
      }

      // Skill listing + usage instructions for model discovery
      if (this.config.skills?.modelDiscovery !== false) {
        const budgetChars = Math.floor(this.config.maxContextTokens * 4 * 0.01); // ~1% of context
        const listing = this.skillManager.buildSkillListing(budgetChars);
        if (listing) {
          const listContent = buildSkillToolPrompt(listing);
          injections.push({
            source: 'skill:listing',
            priority: 9,
            content: listContent,
            tokens: estimateTokens(listContent),
          });
        }
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

    // MCP server instructions injection
    for (const conn of this.mcpAdapter.getConnections()) {
      if (conn.instructions) {
        const tokens = estimateTokens(conn.instructions);
        injections.push({
          source: `mcp:${conn.name}:instructions`,
          priority: 5,
          content: `[MCP Server "${conn.name}" instructions]\n${conn.instructions}`,
          tokens,
        });
      }
    }

    // Memory injection — file-based system
    if (this.fileMemorySystem) {
      try {
        // Behavioral instructions (types, when to save, verification rules)
        const instructions = this.fileMemorySystem.getMemoryInstructions();
        const instrTokens = estimateTokens(instructions);
        injections.push({ source: 'memory:instructions', priority: 2, content: instructions, tokens: instrTokens });

        // MEMORY.md index content
        const indexContent = await this.fileMemorySystem.buildContextPrompt(threadId);
        if (indexContent) {
          const tokens = estimateTokens(indexContent);
          injections.push({ source: 'memory:index', priority: 3, content: `## MEMORY.md\n${indexContent}`, tokens });
        }

        // LLM-selected relevant memories (from prefetch — already running in parallel)
        const relevant = memoryPrefetch ? await memoryPrefetch : [];
        if (relevant.length > 0) {
          const content = relevant.map(m => {
            const freshness = memoryFreshnessNote(m.mtimeMs);
            const header = m.name ?? m.filename;
            return `- ${header}:${freshness ? ` ${freshness}` : ''} ${m.content}`;
          }).join('\n');
          const tokens = estimateTokens(content);
          injections.push({ source: 'memory:relevant', priority: 4, content: `Relevant memories:\n${content}`, tokens });

          // Track surfaced filenames to avoid re-injection in subsequent turns
          for (const m of relevant) {
            this.surfacedMemories.add(m.filename);
          }
        }
      } catch {
        // Memory recall failed — continue without it
      }
    }

    return { injections, skillToolNames };
  }
}
