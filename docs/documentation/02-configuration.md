# Configuration Reference

All configuration is passed to `Agent.create()` and validated with Zod at creation time. Invalid config throws a `ZodError`.

```typescript
import { Agent, type AgentConfigInput } from 'pure-agent';

const config: AgentConfigInput = {
  apiKey: 'sk-or-v1-...',
  // ... options below
};

const agent = Agent.create(config);
```

---

## Core Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | **required** | OpenRouter API key |
| `model` | `string` | `'anthropic/claude-sonnet-4-20250514'` | Default LLM model |
| `baseUrl` | `string` | `'https://openrouter.ai/api/v1'` | OpenRouter API base URL |
| `systemPrompt` | `string` | `undefined` | System prompt prepended to all conversations |
| `logLevel` | `LogLevel` | `'info'` | Logger verbosity: `debug`, `info`, `warn`, `error`, `silent` |
| `dbPath` | `string` | `'~/.agent/data.db'` | SQLite database file path |

---

## Behavior Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxIterations` | `number` | `10` | Max ReAct loop iterations per call |
| `maxConsecutiveErrors` | `number` | `3` | Max consecutive errors before stopping |
| `onToolError` | `'continue' \| 'stop' \| 'retry'` | `'continue'` | What to do when a tool throws |

### onToolError Strategies

- **`continue`** — Send the error as a `tool_result` to the LLM. The model decides how to proceed.
- **`stop`** — Stop the ReAct loop immediately. The `agent_end` event will have `reason: 'error'`.
- **`retry`** — Re-execute the tool once. If it fails again, falls back to `continue`.

---

## Context Budget

Controls how the context window is managed.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxContextTokens` | `number` | `128,000` | Max tokens in the context window |
| `reserveTokens` | `number` | `4,096` | Tokens reserved for the LLM response |
| `maxPinnedMessages` | `number` | `20` | Max pinned messages kept during compaction |

When the context exceeds the budget, the oldest unpinned messages are trimmed first. Pinned messages and injections (skills, knowledge, memory) are preserved by priority.

---

## Cost Policy

Prevents runaway token consumption.

```typescript
const agent = Agent.create({
  apiKey: '...',
  costPolicy: {
    maxTokensPerExecution: 10_000,   // Per stream() call
    maxTokensPerSession: 100_000,    // Across agent lifetime
    maxToolCallsPerExecution: 20,    // Max tool invocations per call
    onLimitReached: 'stop',          // 'stop' or 'warn'
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxTokensPerExecution` | `number` | `undefined` | Hard cap per `stream()` call |
| `maxTokensPerSession` | `number` | `undefined` | Hard cap across agent lifetime |
| `maxToolCallsPerExecution` | `number` | `50` | Max tool calls in a single execution |
| `onLimitReached` | `'stop' \| 'warn'` | `'stop'` | Action when limit is hit |

---

## Memory Configuration

```typescript
const agent = Agent.create({
  apiKey: '...',
  memory: {
    enabled: true,            // default
    decayFactor: 0.95,        // Confidence multiplier per interval
    decayInterval: 10,        // Apply decay every N turns
    minConfidence: 0.1,       // Delete memories below this
    samplingRate: 0.3,        // Extract memories 30% of turns
    store: customMemoryStore, // Optional custom store
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable memory subsystem |
| `store` | `MemoryStore` | SQLite | Custom memory store implementation |
| `decayFactor` | `number` | `0.95` | Confidence decay multiplier (0-1) |
| `decayInterval` | `number` | `10` | Turns between decay applications |
| `minConfidence` | `number` | `0.1` | Minimum confidence threshold |
| `samplingRate` | `number` | `0.3` | Fraction of turns triggering extraction |

---

## Knowledge / RAG Configuration

```typescript
const agent = Agent.create({
  apiKey: '...',
  knowledge: {
    enabled: true,
    chunkSize: 512,           // Characters per chunk
    chunkOverlap: 64,         // Overlap between chunks
    topK: 5,                  // Chunks retrieved per query
    minScore: 0.3,            // Minimum similarity score
    store: customVectorStore, // Optional custom store
  },
  embeddingModel: 'openai/text-embedding-3-small',
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable/disable knowledge subsystem |
| `store` | `VectorStore` | SQLite | Custom vector store |
| `chunkSize` | `number` | `512` | Characters per document chunk |
| `chunkOverlap` | `number` | `64` | Overlapping characters between chunks |
| `topK` | `number` | `5` | Number of chunks to retrieve |
| `minScore` | `number` | `0.3` | Minimum cosine similarity |
| `embeddingModel` | `string` | `'openai/text-embedding-3-small'` | Model for embeddings |

---

## Conversation Store

```typescript
const agent = Agent.create({
  apiKey: '...',
  conversation: {
    store: customConversationStore,
  },
});
```

By default, conversations are stored in memory. Use `SQLiteConversationStore` or a custom implementation for persistence.

---

## Deterministic Mode (Testing)

```typescript
const agent = Agent.create({
  apiKey: '...',
  deterministic: true,
  seed: 42,
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `deterministic` | `boolean` | `false` | Enable deterministic mode |
| `seed` | `number` | `undefined` | Random seed for reproducibility |

---

## MCP Servers

```typescript
const agent = Agent.create({
  apiKey: '...',
  mcp: [
    {
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      timeout: 30_000,
      maxRetries: 3,
      healthCheckInterval: 60_000,
      isolateErrors: true,
    },
  ],
});
```

See [MCP Integration](./06-mcp.md) for details.

---

## Full Example

```typescript
import { Agent } from 'pure-agent';

const agent = Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: 'anthropic/claude-sonnet-4-20250514',
  systemPrompt: 'You are a helpful coding assistant.',

  maxIterations: 15,
  onToolError: 'continue',

  costPolicy: {
    maxTokensPerExecution: 50_000,
    maxTokensPerSession: 500_000,
    onLimitReached: 'stop',
  },

  memory: {
    enabled: true,
    samplingRate: 0.5,
  },

  knowledge: {
    enabled: true,
    topK: 3,
    minScore: 0.4,
  },

  logLevel: 'warn',
});
```
