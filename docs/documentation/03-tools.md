# Tools Guide

Tools give the agent the ability to take actions — read files, call APIs, query databases, or anything else your application needs.

---

## Defining a Tool

Every tool has a name, description, Zod schema for parameters, and an `execute` function.

```typescript
import { z } from 'zod';
import type { AgentTool } from 'pure-agent';

const searchTool: AgentTool = {
  name: 'search_docs',
  description: 'Search the documentation for a given query',
  parameters: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().int().positive().default(5).describe('Max results'),
  }),
  execute: async (args, signal) => {
    const results = await searchDatabase(args.query, args.limit, signal);
    return JSON.stringify(results);
  },
};
```

### Key Points

- **`name`** — Unique identifier. The LLM uses this to decide which tool to call.
- **`description`** — Shown to the LLM. Be clear about when and why to use the tool.
- **`parameters`** — Zod schema. Automatically converted to JSON Schema for the LLM. Arguments are validated before `execute()` runs.
- **`execute(args, signal)`** — Your implementation. Receives validated args and an `AbortSignal` for cancellation.

### Return Types

```typescript
// Simple: return a string
execute: async (args) => 'Operation completed successfully'

// Rich: return an AgentToolResult with metadata
execute: async (args) => ({
  content: 'File saved',
  metadata: { path: '/tmp/output.txt', bytes: 1024 },
})

// Error: return an AgentToolResult with isError
execute: async (args) => ({
  content: 'File not found: /missing.txt',
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

## Complete Example

```typescript
import { Agent } from 'pure-agent';
import { z } from 'zod';

const agent = Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY!,
  systemPrompt: 'You are a math assistant. Use tools when needed.',
  onToolError: 'continue',
});

agent.addTool({
  name: 'calculate',
  description: 'Evaluate a mathematical expression',
  parameters: z.object({
    expression: z.string().describe('Math expression, e.g. "2 + 3 * 4"'),
  }),
  execute: async ({ expression }) => {
    const result = Function(`"use strict"; return (${expression})`)();
    return `${expression} = ${result}`;
  },
});

const answer = await agent.chat('What is 15 factorial divided by 13 factorial?');
console.log(answer);

await agent.destroy();
```
