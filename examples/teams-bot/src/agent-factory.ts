import { Agent } from 'agentx-sdk';
import { config } from './config.js';
import { createTools } from './tools.js';

interface PoolEntry {
  agent: Agent;
  lastUsedAt: number;
}

/** One agent per conversation — full isolation of state, tools, and memory. */
const pool = new Map<string, PoolEntry>();

/** Conversations currently being initialized — prevents duplicate creation. */
const initializing = new Map<string, Promise<Agent>>();

/** Cleanup idle agents every 5 minutes. */
const CLEANUP_INTERVAL = 5 * 60_000;

/** Destroy agents idle for more than 30 minutes. */
const IDLE_TTL = 30 * 60_000;

const SYSTEM_PROMPT = `You are Albert, a helpful Microsoft Teams assistant for managing businesses on the Albert platform.

You have PERSISTENT MEMORY across conversations. You remember facts, preferences, and context from previous messages. Never say you don't have memory or don't remember previous conversations — you do.

CRITICAL RULES FOR TOOL USAGE:
- You HAVE tools available. NEVER say you don't have access to tools or can't query data — you CAN.
- When the user asks for data or actions (listing, creating, updating, searching), ALWAYS use the appropriate tool.
- Do NOT use tools for greetings, thanks, small talk, opinions, or general conversation.
- If the user says "obrigado", "ok", "entendi", just respond naturally WITHOUT calling any tool.
- Think before acting: does this message require data from an external system? If yes, USE your tools. If no, just respond.
- NEVER refuse a data request claiming you can't access the platform — you have full tool access.

RESPONSE STYLE:
- Answer ONLY what was asked. Nothing more.
- NEVER offer extra options, suggestions, or "I can also do X" at the end of a response.
- NEVER ask "do you want me to also..." or "I can also show you..." — just answer the question.
- Be direct and concise. No filler, no upselling features.
- If the user wants something else, they will ask.

Formatting:
- Be concise. Teams messages should be clear and readable.
- You can use Markdown: **bold**, *italic*, \`code\`, code blocks, lists, and headers.
- Use emojis to make the conversation more engaging.
- Respond in the same language the user writes in.`;

/**
 * Returns an isolated Agent for the given conversation.
 * Creates one on first access; subsequent calls return the cached instance.
 */
export async function getAgent(conversationId: string): Promise<Agent> {
  // Return existing agent
  const entry = pool.get(conversationId);
  if (entry) {
    entry.lastUsedAt = Date.now();
    return entry.agent;
  }

  // Deduplicate concurrent init for the same conversation
  if (initializing.has(conversationId)) {
    return initializing.get(conversationId)!;
  }

  const promise = createAgent(conversationId);
  initializing.set(conversationId, promise);

  try {
    const agent = await promise;
    pool.set(conversationId, { agent, lastUsedAt: Date.now() });
    return agent;
  } finally {
    initializing.delete(conversationId);
  }
}

async function createAgent(conversationId: string): Promise<Agent> {
  const agent = Agent.create({
    apiKey: config.agent.apiKey,
    model: config.agent.model,
    systemPrompt: SYSTEM_PROMPT,

    memory: {
      enabled: true,
      samplingRate: 0.4,
      extractionInterval: 20,
    },

    knowledge: { enabled: true },

    costPolicy: {
      maxTokensPerExecution: 30_000,
      maxTokensPerSession: 1_000_000,
      onLimitReached: 'warn',
    },

    maxIterations: 20,
    onToolError: 'continue',
    logLevel: 'debug',
    dbPath: './data/agent.db',
  });

  // Register tools — pass agent getter so search_knowledge can reference this instance
  for (const tool of createTools(() => agent)) {
    agent.addTool(tool);
  }

  // Connect MCP servers
  if (config.mcp.albert.url) {
    try {
      await agent.connectMCP({
        name: 'albert',
        transport: 'sse',
        url: config.mcp.albert.url,
        headers: config.mcp.albert.headers,
        timeout: 60_000,
      });
    } catch (error) {
      console.error(`[${conversationId}] Failed to connect MCP albert:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`[pool] Agent created for conversation ${conversationId.slice(0, 20)}... (pool size: ${pool.size + 1})`);
  return agent;
}

/**
 * Destroy a specific conversation's agent.
 */
export async function destroyAgent(conversationId: string): Promise<void> {
  const entry = pool.get(conversationId);
  if (entry) {
    pool.delete(conversationId);
    await entry.agent.destroy();
    console.log(`[pool] Agent destroyed for conversation ${conversationId.slice(0, 20)}...`);
  }
}

/**
 * Destroy all agents (graceful shutdown).
 */
export async function destroyAll(): Promise<void> {
  const entries = [...pool.entries()];
  pool.clear();
  await Promise.allSettled(entries.map(([id, e]) => {
    console.log(`[pool] Destroying agent ${id.slice(0, 20)}...`);
    return e.agent.destroy();
  }));
}

/** Pool stats for monitoring. */
export function getPoolStats(): { size: number; conversationIds: string[] } {
  return { size: pool.size, conversationIds: [...pool.keys()] };
}

/** @internal — test-only: clear pool state between tests. */
export function _resetPool(): void {
  pool.clear();
  initializing.clear();
}

// --- Periodic cleanup of idle agents ---
setInterval(async () => {
  const now = Date.now();
  const toRemove: string[] = [];

  for (const [id, entry] of pool) {
    if (now - entry.lastUsedAt > IDLE_TTL) {
      toRemove.push(id);
    }
  }

  for (const id of toRemove) {
    await destroyAgent(id);
    console.log(`[pool] Evicted idle agent ${id.slice(0, 20)}...`);
  }

  if (toRemove.length > 0) {
    console.log(`[pool] Cleanup: evicted ${toRemove.length}, remaining ${pool.size}`);
  }
}, CLEANUP_INTERVAL).unref();
