# Pure Agent Documentation

**Pure Agent** is a standalone TypeScript library for building conversational AI agents with streaming, tool calling, persistent memory, knowledge/RAG, skills, and MCP support — all with minimal dependencies.

---

## Table of Contents

| # | Document | Description |
|---|----------|-------------|
| 01 | [Getting Started](./01-getting-started.md) | Installation, quick start, core concepts |
| 02 | [Configuration](./02-configuration.md) | All config options with defaults and examples |
| 03 | [Tools](./03-tools.md) | Creating, registering, and using tools |
| 04 | [Memory & Knowledge](./04-memory-knowledge.md) | Persistent memory, RAG, hybrid search |
| 05 | [Skills](./05-skills.md) | Contextual behavior modification |
| 06 | [MCP Integration](./06-mcp.md) | Connecting external tool servers |
| 07 | [Streaming Events](./07-events.md) | All event types and usage patterns |
| 08 | [Custom Stores](./08-custom-stores.md) | Pluggable persistence (Postgres, Redis, Pinecone) |
| 09 | [API Reference](./09-api-reference.md) | Complete type reference |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      Agent                               │
│   chat() ──wraps──► stream() ──► AsyncIterableIterator   │
├─────────────────────────────────────────────────────────┤
│  ContextPipeline    │  ReactLoop      │  StreamEmitter   │
│  ├── Skills Stage   │  ├── LLM call   │  └── Events      │
│  ├── Knowledge      │  ├── Tool exec  │                   │
│  ├── Memory         │  └── Iterate    │                   │
│  └── History        │                 │                   │
├─────────────────────────────────────────────────────────┤
│  OpenRouterClient   │  ToolExecutor   │  MCPAdapter       │
│  ├── streamChat()   │  ├── register() │  ├── connect()    │
│  ├── chat()         │  ├── execute()  │  └── disconnect() │
│  └── embed()        │  └── parallel() │                   │
├─────────────────────────────────────────────────────────┤
│  MemoryStore        │  VectorStore    │  ConversationStore │
│  (SQLite default)   │  (SQLite)       │  (In-memory)       │
└─────────────────────────────────────────────────────────┘
```

---

## Key Design Principles

1. **Minimal dependencies** — 3 runtime deps: `zod`, `better-sqlite3`, `zod-to-json-schema`
2. **Streaming first** — `stream()` is the primary API; `chat()` is a convenience wrapper
3. **Pluggable stores** — `MemoryStore`, `VectorStore`, `ConversationStore` are interfaces
4. **Cost control** — `CostPolicy` with per-execution and per-session limits
5. **Fault tolerance** — Retry with backoff, error isolation, graceful degradation
6. **Observability** — Every execution has a `traceId`; all events include timing data

---

## Requirements

- Node.js 22+
- OpenRouter API key
- Optional: `@modelcontextprotocol/sdk` for MCP support
