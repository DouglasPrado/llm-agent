import { Agent } from 'pure-agent';
import { config } from './config.js';
import { createTools } from './tools.js';

let agent: Agent | null = null;

/**
 * Creates and configures the shared Agent instance.
 * Uses a singleton — one agent handles all Telegram chats.
 * Each chat is isolated via threadId = chatId.
 */
export async function getAgent(): Promise<Agent> {
  if (agent) return agent;

  agent = Agent.create({
    apiKey: config.agent.apiKey,
    model: config.agent.model,
    systemPrompt: `You are Albert, a helpful Telegram assistant for managing businesses on the Albert platform.

You have PERSISTENT MEMORY across conversations. You remember facts, preferences, and context from previous messages. Never say you don't have memory or don't remember previous conversations — you do.

CRITICAL RULES FOR TOOL USAGE:
- ONLY use tools when the user explicitly asks for data or actions (listing, creating, updating, searching).
- Do NOT use tools for greetings, thanks, small talk, opinions, or general conversation.
- If the user says "obrigado", "ok", "entendi", just respond naturally WITHOUT calling any tool.
- Think before acting: does this message require data from an external system? If no, just respond.

Formatting:
- Be concise. Telegram messages should be short and readable.
- Use plain text or minimal Markdown (bold, italic, code blocks).
- Do NOT use headers (#) — Telegram doesn't render them.
- Respond in the same language the user writes in.`,

    memory: {
      enabled: true,
      samplingRate: 0.4,
      decayInterval: 20,
    },

    knowledge: { enabled: false },

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

  // Register tools
  for (const tool of createTools()) {
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
      console.error('Failed to connect MCP albert:', error instanceof Error ? error.message : error);
    }
  }

  return agent;
}

export async function destroyAgent(): Promise<void> {
  if (agent) {
    await agent.destroy();
    agent = null;
  }
}
