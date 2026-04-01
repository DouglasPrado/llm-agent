# Memory & Knowledge (RAG)

Pure Agent has two persistence subsystems:

- **Memory** — facts extracted from conversations that persist across sessions (e.g., "user prefers TypeScript")
- **Knowledge** — documents ingested for RAG retrieval (e.g., API docs, codebase context)

Both are enabled by default with SQLite storage. Both are pluggable.

---

## Memory

### Saving Memories

```typescript
const agent = Agent.create({ apiKey: '...' });

// Explicit memory — saved with confidence 1.0
const mem = await agent.remember('User prefers dark mode');

// With scope
await agent.remember('This project uses React', 'persistent');
await agent.remember('Current task is refactoring auth', 'thread');
```

### Recalling Memories

```typescript
const memories = await agent.recall('What does the user prefer?');

for (const mem of memories) {
  console.log(`${mem.content} (confidence: ${mem.confidence})`);
}
```

### Memory Scopes

| Scope | Visibility | Use Case |
|-------|-----------|----------|
| `persistent` | All threads | Long-term user preferences, facts |
| `thread` | Only the originating thread | Task-specific context |
| `learned` | All threads | Patterns learned from interactions |

### Memory Categories

Memories are categorized for better retrieval:

| Category | Example |
|----------|---------|
| `fact` | "The API key is stored in .env" |
| `preference` | "User prefers concise answers" |
| `procedure` | "Deploy by running npm run deploy" |
| `insight` | "User tends to ask follow-up questions" |
| `context` | "Currently working on the auth module" |

### Memory Lifecycle

```
active → reinforced (on recall)
       → decaying (after N turns without access)
       → expired (confidence < minConfidence)
       → removed (cleaned up)
```

- **Confidence** starts at 0.8 (extracted) or 1.0 (explicit)
- **Reinforcement**: +0.05 confidence each time recalled
- **Decay**: `confidence *= decayFactor` every `decayInterval` turns
- **Cleanup**: memories below `minConfidence` are deleted automatically

### Automatic Extraction

The agent automatically extracts memories from conversations based on:

1. **Explicit triggers** — "remember that...", "lembra que..."
2. **Turn count** — after `decayInterval` turns without extraction
3. **Random sampling** — `samplingRate` fraction of turns (default 30%)

### Hybrid Search

Memory recall uses **Reciprocal Rank Fusion** combining:
- **FTS5** — full-text search for keyword matching
- **Cosine similarity** — semantic vector search via embeddings

This ensures both exact term matches and semantic similarity are considered.

### Configuration

```typescript
const agent = Agent.create({
  apiKey: '...',
  memory: {
    enabled: true,
    decayFactor: 0.95,
    decayInterval: 10,
    minConfidence: 0.1,
    samplingRate: 0.3,
  },
});
```

---

## Knowledge / RAG

### Ingesting Documents

```typescript
const agent = Agent.create({ apiKey: '...' });

await agent.ingestKnowledge({
  content: 'Full text of the document here...',
  metadata: {
    source: 'api-docs',
    title: 'Authentication Guide',
    url: 'https://docs.example.com/auth',
  },
});
```

Documents are automatically:
1. **Chunked** — split into overlapping segments (default: 512 chars, 64 overlap)
2. **Embedded** — converted to vectors via the embedding model
3. **Stored** — persisted in the VectorStore (SQLite by default)

### Automatic RAG Injection

During every `stream()` / `chat()` call, the agent:
1. Generates an embedding for the user's input
2. Searches the VectorStore for similar chunks
3. Injects the top-K results into the system context

This happens transparently — no manual search needed.

### Manual Search

If you need to search knowledge programmatically:

```typescript
import { KnowledgeManager } from 'pure-agent';
// KnowledgeManager is used internally, but you can access
// the VectorStore directly via custom stores
```

### Chunking Strategies

Documents are split using **recursive character splitting**:

1. Try splitting on `\n\n` (paragraph boundaries)
2. Fall back to `\n` (line boundaries)
3. Fall back to `. ` (sentence boundaries)
4. Fall back to ` ` (word boundaries)

Overlap ensures that information at chunk boundaries isn't lost.

### Embedding Caching

Embeddings are cached in an LRU cache (max 10,000 entries, 1-hour TTL) to avoid redundant API calls.

### Configuration

```typescript
const agent = Agent.create({
  apiKey: '...',
  knowledge: {
    enabled: true,
    chunkSize: 512,
    chunkOverlap: 64,
    topK: 5,
    minScore: 0.3,
  },
  embeddingModel: 'openai/text-embedding-3-small',
});
```

---

## Disabling Subsystems

```typescript
// Disable memory (no extraction, no recall)
const agent = Agent.create({
  apiKey: '...',
  memory: { enabled: false },
});

// Disable knowledge (no RAG)
const agent = Agent.create({
  apiKey: '...',
  knowledge: { enabled: false },
});

// Disable both (minimal agent)
const agent = Agent.create({
  apiKey: '...',
  memory: { enabled: false },
  knowledge: { enabled: false },
});
```

---

## Context Pipeline Priority

When building the context, injections are prioritized:

| Source | Priority | Description |
|--------|----------|-------------|
| Skills | 8 | Highest — skill instructions |
| Knowledge | 6 | RAG results |
| Memory | 4 | Recalled memories |

Higher priority injections are included first. If the context budget is exceeded, lower priority injections are dropped.
