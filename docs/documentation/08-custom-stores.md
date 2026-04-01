# Custom Stores

Pure Agent uses SQLite by default for all persistence. You can replace any store with your own implementation by providing a class that implements the corresponding interface.

---

## Store Interfaces

There are three pluggable interfaces:

| Interface | Purpose | Default Implementation |
|-----------|---------|----------------------|
| `MemoryStore` | Memory persistence and search | `SQLiteMemoryStore` |
| `VectorStore` | Knowledge chunk storage and search | `SQLiteVectorStore` |
| `ConversationStore` | Conversation history | In-memory / `SQLiteConversationStore` |

---

## MemoryStore

```typescript
import type { MemoryStore, Memory, MemorySearchOptions } from 'pure-agent';

class PostgresMemoryStore implements MemoryStore {
  save(memory: Memory): Memory {
    // INSERT INTO memories ...
    return memory;
  }

  search(query: string, options?: MemorySearchOptions): Memory[] {
    // Full-text search + optional vector search
    // options.limit, options.scope, options.threadId, options.minConfidence, options.embedding
    return [];
  }

  findById(id: string): Memory | null {
    // SELECT * FROM memories WHERE id = $1
    return null;
  }

  incrementAccess(id: string): void {
    // UPDATE memories SET access_count = access_count + 1, confidence = LEAST(confidence + 0.05, 1.0) ...
  }

  deleteLowConfidence(minConfidence: number): number {
    // DELETE FROM memories WHERE confidence < $1
    return 0;
  }

  listByScope(scope: string, threadId?: string): Memory[] {
    // SELECT * FROM memories WHERE scope = $1 ...
    return [];
  }
}
```

### Usage

```typescript
const agent = Agent.create({
  apiKey: '...',
  memory: {
    enabled: true,
    store: new PostgresMemoryStore(pool),
  },
});
```

---

## VectorStore

```typescript
import type { VectorStore, KnowledgeChunk, RetrievedKnowledge } from 'pure-agent';

class PineconeVectorStore implements VectorStore {
  upsert(chunk: KnowledgeChunk): void {
    // Upsert vector to Pinecone
  }

  search(queryEmbedding: Float32Array, topK: number): RetrievedKnowledge[] {
    // Query Pinecone for nearest neighbors
    return [];
  }

  delete(id: string): void {
    // Delete vector by ID
  }

  listAll(): KnowledgeChunk[] {
    // List all vectors (for migration/export)
    return [];
  }

  deleteBySource(sourceId: string): void {
    // Delete all vectors from a specific document source
  }
}
```

### Usage

```typescript
const agent = Agent.create({
  apiKey: '...',
  knowledge: {
    enabled: true,
    store: new PineconeVectorStore(pineconeClient),
  },
});
```

---

## ConversationStore

```typescript
import type { ConversationStore, ChatMessage } from 'pure-agent';

class RedisConversationStore implements ConversationStore {
  appendMessage(message: ChatMessage, threadId: string): void {
    // RPUSH thread:{threadId} message
  }

  listThread(threadId: string): ChatMessage[] {
    // LRANGE thread:{threadId} 0 -1
    return [];
  }

  listPinned(threadId: string): ChatMessage[] {
    // Filter pinned messages
    return [];
  }

  clearThread(threadId: string): void {
    // DEL thread:{threadId}
  }
}
```

### Usage

```typescript
const agent = Agent.create({
  apiKey: '...',
  conversation: {
    store: new RedisConversationStore(redisClient),
  },
});
```

---

## Using Built-in SQLite Stores Directly

You can also use the SQLite implementations directly (e.g., for testing or custom setups):

```typescript
import { SQLiteDatabase, SQLiteMemoryStore, SQLiteVectorStore, SQLiteConversationStore } from 'pure-agent';

const db = new SQLiteDatabase('./my-data.db');
db.initialize();

const memoryStore = new SQLiteMemoryStore(db);
const vectorStore = new SQLiteVectorStore(db);
const conversationStore = new SQLiteConversationStore(db);

const agent = Agent.create({
  apiKey: '...',
  memory: { store: memoryStore },
  knowledge: { store: vectorStore },
  conversation: { store: conversationStore },
  dbPath: './my-data.db',
});
```

---

## Testing with Custom Stores

Custom stores make testing easy — use mocks:

```typescript
import { vi } from 'vitest';
import type { MemoryStore } from 'pure-agent';

const mockStore: MemoryStore = {
  save: vi.fn((m) => m),
  search: vi.fn(() => []),
  findById: vi.fn(() => null),
  incrementAccess: vi.fn(),
  deleteLowConfidence: vi.fn(() => 0),
  listByScope: vi.fn(() => []),
};

const agent = Agent.create({
  apiKey: 'test-key',
  memory: { store: mockStore },
  knowledge: { enabled: false },
});
```

---

## When to Use Custom Stores

| Scenario | Recommendation |
|----------|---------------|
| Development / prototyping | Default SQLite (zero config) |
| Production with > 100K vectors | PgVector or Pinecone for `VectorStore` |
| Multi-process / distributed | Redis for `ConversationStore`, Postgres for `MemoryStore` |
| Serverless (no filesystem) | All custom stores (Redis, DynamoDB, etc.) |
| Testing | Mock implementations |
