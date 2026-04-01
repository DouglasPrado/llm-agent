# Getting Started

## Installation

```bash
npm install pure-agent
```

### Requirements

- **Node.js 22+** (uses native `fetch()`, `AbortSignal`, dynamic import)
- **OpenRouter API key** — get one at [openrouter.ai](https://openrouter.ai)

### Optional Dependencies

```bash
# For MCP (Model Context Protocol) support
npm install @modelcontextprotocol/sdk
```

---

## Quick Start

### Simple Chat

```typescript
import { Agent } from 'pure-agent';

const agent = Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: 'anthropic/claude-sonnet-4-20250514',
});

const response = await agent.chat('What is TypeScript?');
console.log(response);

await agent.destroy();
```

### Streaming

```typescript
import { Agent } from 'pure-agent';

const agent = Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

for await (const event of agent.stream('Explain recursion')) {
  switch (event.type) {
    case 'text_delta':
      process.stdout.write(event.content);
      break;
    case 'agent_end':
      console.log(`\n\nTokens used: ${event.usage.totalTokens}`);
      break;
  }
}

await agent.destroy();
```

### With Tools

```typescript
import { Agent } from 'pure-agent';
import { z } from 'zod';

const agent = Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY!,
  systemPrompt: 'You are a helpful assistant with access to tools.',
});

agent.addTool({
  name: 'get_weather',
  description: 'Get the current weather for a city',
  parameters: z.object({
    city: z.string().describe('City name'),
    unit: z.enum(['C', 'F']).optional().describe('Temperature unit'),
  }),
  execute: async ({ city, unit }) => {
    // Your actual weather API call here
    return `The weather in ${city} is 22${unit ?? 'C'} and sunny.`;
  },
});

const response = await agent.chat('What is the weather in Tokyo?');
console.log(response);
// "The weather in Tokyo is 22C and sunny."

await agent.destroy();
```

### Multi-Turn Conversations (Threads)

```typescript
const agent = Agent.create({ apiKey: process.env.OPENROUTER_API_KEY! });

// Thread 1
await agent.chat('My name is Alice', { threadId: 'thread-1' });
const r1 = await agent.chat('What is my name?', { threadId: 'thread-1' });
console.log(r1); // "Your name is Alice"

// Thread 2 — isolated
const r2 = await agent.chat('What is my name?', { threadId: 'thread-2' });
console.log(r2); // "I don't know your name"

await agent.destroy();
```

---

## Core Concepts

### Agent

The `Agent` class is the single entry point. It orchestrates all subsystems: LLM communication, tool execution, memory, knowledge/RAG, skills, and MCP.

Create an agent with `Agent.create(config)`. The config is validated at creation time via Zod.

### stream() vs chat()

- **`stream()`** is the primary API. Returns `AsyncIterableIterator<AgentEvent>` with granular events.
- **`chat()`** is a convenience wrapper. Consumes `stream()` internally and returns the final text.

Always prefer `stream()` for production use — it gives you access to tool call events, cost tracking, and real-time text delivery.

### Events

Every `stream()` call emits a sequence of `AgentEvent` objects:

```
agent_start → turn_start → text_delta* → text_done → turn_end → agent_end
```

With tool calls:
```
agent_start → turn_start → tool_call_start → tool_call_end → turn_end
            → turn_start → text_delta* → text_done → turn_end → agent_end
```

### Lifecycle

```typescript
const agent = Agent.create(config);    // Initialize
// ... use agent ...
await agent.destroy();                  // Cleanup (closes DB, disconnects MCP)
```

Always call `destroy()` when done. After `destroy()`, `stream()` and `chat()` will throw.

---

## Next Steps

- [Configuration Reference](./02-configuration.md) — all config options
- [Tools Guide](./03-tools.md) — creating and registering tools
- [Memory & Knowledge](./04-memory-knowledge.md) — persistent memory and RAG
- [Skills](./05-skills.md) — contextual behavior modification
- [MCP Integration](./06-mcp.md) — connecting external tool servers
- [Streaming Events](./07-events.md) — all event types
- [Custom Stores](./08-custom-stores.md) — pluggable persistence
- [API Reference](./09-api-reference.md) — complete type reference
