import { Agent } from 'pure-agent';
import { config } from './config.js';
import { createTools } from './tools.js';

let agent: Agent | null = null;

/**
 * Creates and configures the shared Agent instance.
 * Uses a singleton — one agent handles all Telegram chats.
 * Each chat is isolated via threadId = chatId.
 */
export function getAgent(): Agent {
  if (agent) return agent;

  agent = Agent.create({
    apiKey: config.agent.apiKey,
    model: config.agent.model,
    systemPrompt: `You are a helpful Telegram assistant.

Rules:
- Be concise. Telegram messages should be short and readable.
- Use plain text or minimal Markdown (bold, italic, code blocks).
- Do NOT use headers (#) — Telegram doesn't render them.
- When using web_search, summarize the results. Don't dump raw links.
- Respond in the same language the user writes in.
- If the user asks for something you can't do, say so clearly.`,

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

    maxIterations: 8,
    onToolError: 'continue',
    logLevel: 'info',
    dbPath: './data/agent.db',
  });

  // Register tools
  for (const tool of createTools()) {
    agent.addTool(tool);
  }

  return agent;
}

export async function destroyAgent(): Promise<void> {
  if (agent) {
    await agent.destroy();
    agent = null;
  }
}
