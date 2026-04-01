import { z } from 'zod';
import type { AgentTool } from 'pure-agent';
import { config } from './config.js';

/**
 * All tools available to the agent.
 * Add or remove tools here to customize the bot's capabilities.
 */
export function createTools(): AgentTool[] {
  const tools: AgentTool[] = [];

  // Web search via Tavily (if API key provided)
  if (config.tavily.apiKey) {
    tools.push({
      name: 'web_search',
      description: 'Search the web for current information, news, facts, or documentation. Use when the user asks about recent events, technical questions, or anything that may require up-to-date data.',
      parameters: z.object({
        query: z.string().describe('Search query — be specific for better results'),
        max_results: z.number().int().min(1).max(10).default(5).describe('Number of results'),
        search_depth: z.enum(['basic', 'advanced']).default('basic').describe('basic = fast, advanced = thorough'),
      }),
      execute: async (rawArgs, signal) => {
        const args = rawArgs as { query: string; max_results: number; search_depth: string };
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: config.tavily.apiKey,
            query: args.query,
            max_results: args.max_results,
            search_depth: args.search_depth,
            include_answer: true,
          }),
          signal,
        });

        if (!response.ok) {
          return { content: `Search failed: ${response.status}`, isError: true };
        }

        const data = await response.json() as {
          answer?: string;
          results: Array<{ title: string; url: string; content: string }>;
        };

        const results = data.results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content}`)
          .join('\n\n');

        return data.answer
          ? `Answer: ${data.answer}\n\nSources:\n${results}`
          : results;
      },
    });
  }

  // Current date/time
  tools.push({
    name: 'get_current_time',
    description: 'Get the current date and time. Use when the user asks "what time is it", "what day is today", or needs temporal context.',
    parameters: z.object({
      timezone: z.string().default('America/Sao_Paulo').describe('IANA timezone'),
    }),
    execute: async (rawArgs) => {
      const args = rawArgs as { timezone: string };
      const now = new Date();
      const formatted = now.toLocaleString('pt-BR', { timeZone: args.timezone, dateStyle: 'full', timeStyle: 'long' });
      return `Current date/time (${args.timezone}): ${formatted}`;
    },
  });

  return tools;
}
