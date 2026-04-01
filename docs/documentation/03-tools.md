# Tools Guide

Tools give the agent the ability to take actions — search the web, call APIs, read files, query databases, or anything else your application needs.

---

## Defining a Tool

Every tool has a name, description, Zod schema for parameters, and an `execute` function. Here's a real-world example using the [Tavily](https://tavily.com/) search API:

```typescript
import { z } from 'zod';
import type { AgentTool } from 'pure-agent';

const tavilySearch: AgentTool = {
  name: 'web_search',
  description: 'Search the web for current information using Tavily. Use this when you need up-to-date facts, news, documentation, or any information beyond your training data.',
  parameters: z.object({
    query: z.string().describe('The search query'),
    max_results: z.number().int().min(1).max(10).default(5).describe('Number of results to return'),
    search_depth: z.enum(['basic', 'advanced']).default('basic').describe('Search depth: basic is faster, advanced is more thorough'),
    include_answer: z.boolean().default(true).describe('Include a generated answer summary'),
  }),
  execute: async (args, signal) => {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: args.query,
        max_results: args.max_results,
        search_depth: args.search_depth,
        include_answer: args.include_answer,
      }),
      signal,
    });

    if (!response.ok) {
      return { content: `Tavily API error: ${response.status}`, isError: true };
    }

    const data = await response.json() as {
      answer?: string;
      results: Array<{ title: string; url: string; content: string; score: number }>;
    };

    const formattedResults = data.results
      .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.content}`)
      .join('\n\n');

    const output = data.answer
      ? `**Answer:** ${data.answer}\n\n**Sources:**\n${formattedResults}`
      : formattedResults;

    return {
      content: output,
      metadata: {
        resultCount: data.results.length,
        hasAnswer: !!data.answer,
        topScore: data.results[0]?.score,
      },
    };
  },
};
```

### Using with the Agent

```typescript
import { Agent } from 'pure-agent';

const agent = Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY!,
  systemPrompt: 'You are a research assistant. Use the web_search tool to find current information when needed.',
});

agent.addTool(tavilySearch);

const answer = await agent.chat('What are the latest features in Node.js 22?');
console.log(answer);

await agent.destroy();
```

### Streaming with Tool Calls

```typescript
for await (const event of agent.stream('Search for the latest TypeScript 5.5 features')) {
  switch (event.type) {
    case 'tool_call_start':
      console.log(`🔍 Searching: ${JSON.parse(event.toolCall.function.arguments).query}`);
      break;
    case 'tool_call_end':
      console.log(`✅ Found ${event.result.metadata?.resultCount} results (${event.duration}ms)`);
      break;
    case 'text_delta':
      process.stdout.write(event.content);
      break;
  }
}
```

### Key Points

- **`name`** — Unique identifier. The LLM uses this to decide which tool to call.
- **`description`** — Shown to the LLM. Be specific about when and why to use the tool. A good description is the difference between the LLM using the tool correctly or ignoring it.
- **`parameters`** — Zod schema. Automatically converted to JSON Schema for the LLM. Arguments are validated before `execute()` runs. Use `.describe()` on each field to help the LLM understand what to pass.
- **`execute(args, signal)`** — Your implementation. Receives validated args and an `AbortSignal` for cancellation. Always pass `signal` to `fetch()` calls for proper abort support.

### Return Types

```typescript
// Simple: return a string
execute: async (args) => 'Operation completed successfully'

// Rich: return an AgentToolResult with metadata
execute: async (args) => ({
  content: 'Found 5 results for "TypeScript"',
  metadata: { resultCount: 5, searchDepth: 'advanced' },
})

// Error: return an AgentToolResult with isError
execute: async (args) => ({
  content: 'Tavily API error: 429 Too Many Requests',
  isError: true,
})
```

---

## Registering and Removing Tools

```typescript
const agent = Agent.create({ apiKey: '...' });

// Register
agent.addTool(searchTool);
agent.addTool(anotherTool);

// Remove
agent.removeTool('search_docs');  // returns true if found
```

Tools can be added or removed at any time. Changes take effect on the next `stream()` / `chat()` call.

---

## Semantic Validation

For tools that need context-aware validation beyond Zod schemas:

```typescript
const deleteTool: AgentTool = {
  name: 'delete_record',
  description: 'Delete a database record by ID',
  parameters: z.object({ id: z.string() }),
  validate: async (args, context) => {
    // Return null to allow, or a string to block with an error message
    if (args.id === 'admin') {
      return 'Cannot delete the admin record';
    }
    return null;
  },
  execute: async (args) => {
    await db.delete(args.id);
    return `Record ${args.id} deleted`;
  },
};
```

The validation chain is:
1. **Zod schema** (structural) — invalid args are rejected immediately
2. **`validate()`** (semantic) — optional context-aware check
3. **`execute()`** — runs only if both pass

---

## Tool Execution Hooks

Hooks let you intercept tool calls for logging, rate limiting, or authorization.

```typescript
import { ToolExecutor } from 'pure-agent';

const executor = new ToolExecutor({
  beforeToolCall: async (name, args) => {
    console.log(`Calling tool: ${name}`, args);
    // Throw to block execution
  },
  afterToolCall: async (name, args, result) => {
    console.log(`Tool result: ${name}`, result.content);
    // Modify result if needed
  },
});
```

---

## Cancellation with AbortSignal

All tool executions receive an `AbortSignal`. Use it for long-running operations:

```typescript
const longRunningTool: AgentTool = {
  name: 'process_data',
  description: 'Process a large dataset',
  parameters: z.object({ dataset: z.string() }),
  execute: async (args, signal) => {
    for (const chunk of loadDataset(args.dataset)) {
      if (signal.aborted) throw new Error('Aborted');
      await processChunk(chunk);
    }
    return 'Processing complete';
  },
};
```

---

## Parallel Execution

When the LLM requests multiple tool calls in a single turn, they execute in parallel via `Promise.all`. This is the default behavior — no configuration needed.

```
LLM: "I need the weather in NYC and Tokyo"
     → tool_call: get_weather({city: "NYC"})      ┐ parallel
     → tool_call: get_weather({city: "Tokyo"})     ┘
```

---

## Error Handling

The `onToolError` config controls what happens when a tool throws:

```typescript
const agent = Agent.create({
  apiKey: '...',
  onToolError: 'continue',  // default
});
```

| Strategy | Behavior |
|----------|----------|
| `continue` | Error sent to LLM as a `tool_result`. The model can try again or use a different approach. |
| `stop` | ReAct loop stops immediately. `agent_end` reason is `'error'`. |
| `retry` | Tool is re-executed once. If it fails again, falls back to `continue`. |

---

## Monitoring Tool Calls via Events

```typescript
for await (const event of agent.stream('...')) {
  switch (event.type) {
    case 'tool_call_start':
      console.log(`Tool called: ${event.toolCall.function.name}`);
      break;
    case 'tool_call_end':
      console.log(`Result: ${event.result.content} (${event.duration}ms)`);
      break;
  }
}
```

---

## Complete Example: Research Agent with Tavily

A fully functional research agent that searches the web and synthesizes answers:

```typescript
import { Agent } from 'pure-agent';
import { z } from 'zod';

const agent = Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: 'anthropic/claude-sonnet-4-20250514',
  systemPrompt: `You are a research assistant. When the user asks a question:
1. Use web_search to find current, authoritative information
2. Synthesize the results into a clear, well-structured answer
3. Always cite your sources with URLs`,
  onToolError: 'continue',
  costPolicy: {
    maxTokensPerExecution: 50_000,
    onLimitReached: 'stop',
  },
});

// Tavily web search tool
agent.addTool({
  name: 'web_search',
  description: 'Search the web for current information. Use for any question requiring up-to-date facts, news, technical docs, or real-world data.',
  parameters: z.object({
    query: z.string().describe('Search query — be specific for better results'),
    max_results: z.number().int().min(1).max(10).default(5),
    search_depth: z.enum(['basic', 'advanced']).default('basic'),
    include_answer: z.boolean().default(true),
  }),
  execute: async (args, signal) => {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: args.query,
        max_results: args.max_results,
        search_depth: args.search_depth,
        include_answer: args.include_answer,
      }),
      signal,
    });

    if (!response.ok) {
      return { content: `Search failed: ${response.status}`, isError: true };
    }

    const data = await response.json() as {
      answer?: string;
      results: Array<{ title: string; url: string; content: string; score: number }>;
    };

    const results = data.results
      .map((r, i) => `${i + 1}. [${r.title}](${r.url})\n   ${r.content}`)
      .join('\n\n');

    return {
      content: data.answer
        ? `Summary: ${data.answer}\n\nSources:\n${results}`
        : results,
      metadata: { resultCount: data.results.length },
    };
  },
});

// Use it
for await (const event of agent.stream('What are the key features of Bun 1.2?')) {
  switch (event.type) {
    case 'tool_call_start':
      console.log(`\n🔍 Searching...\n`);
      break;
    case 'text_delta':
      process.stdout.write(event.content);
      break;
    case 'agent_end':
      console.log(`\n\n📊 Tokens: ${event.usage.totalTokens} | Duration: ${event.duration}ms`);
      break;
  }
}

await agent.destroy();
```

### Multiple Tools Working Together

```typescript
import { Agent } from 'pure-agent';
import { z } from 'zod';

const agent = Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY!,
  systemPrompt: 'You are a research assistant with web search and calculation capabilities.',
});

// Tavily search
agent.addTool({
  name: 'web_search',
  description: 'Search the web for current information',
  parameters: z.object({
    query: z.string(),
    max_results: z.number().default(3),
  }),
  execute: async (args, signal) => {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, ...args }),
      signal,
    });
    const data = await res.json() as { results: Array<{ title: string; content: string }> };
    return data.results.map(r => `${r.title}: ${r.content}`).join('\n');
  },
});

// Calculator
agent.addTool({
  name: 'calculate',
  description: 'Evaluate a mathematical expression',
  parameters: z.object({
    expression: z.string().describe('e.g. "2 + 3 * 4" or "Math.sqrt(144)"'),
  }),
  execute: async ({ expression }) => {
    const result = Function(`"use strict"; return (${expression})`)();
    return `${expression} = ${result}`;
  },
});

// The LLM can now search AND calculate in the same conversation
const answer = await agent.chat(
  'What is the current population of Brazil? And what percentage of the world population is that? (world pop ~8.1 billion)'
);
console.log(answer);
// The agent will:
// 1. web_search("current population of Brazil 2025")
// 2. calculate("215_000_000 / 8_100_000_000 * 100")
// 3. Synthesize: "Brazil's population is ~215M, which is ~2.65% of the world population"

await agent.destroy();
```
