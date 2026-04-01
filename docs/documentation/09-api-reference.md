# API Reference

Complete type reference for the Pure Agent library.

---

## Agent

```typescript
class Agent {
  static create(input: AgentConfigInput): Agent;

  stream(input: string | ContentPart[], options?: ChatOptions): AsyncIterableIterator<AgentEvent>;
  chat(input: string | ContentPart[], options?: ChatOptions): Promise<string>;

  addTool(tool: AgentTool): void;
  removeTool(name: string): boolean;
  addSkill(skill: AgentSkill): void;
  getHistory(threadId?: string): ChatMessage[];

  connectMCP(config: MCPConnectionConfig): Promise<void>;
  disconnectMCP(name: string): Promise<void>;
  getHealth(): MCPHealthStatus;

  remember(content: string, scope?: MemoryScope): Promise<Memory>;
  recall(query: string): Promise<Memory[]>;
  ingestKnowledge(document: KnowledgeDocument): Promise<void>;

  getUsage(): TokenUsage;
  destroy(): Promise<void>;
}
```

---

## ChatOptions

```typescript
interface ChatOptions {
  threadId?: string;
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}
```

---

## AgentTool

```typescript
interface AgentTool {
  name: string;
  description: string;
  parameters: ZodSchema;
  execute: (args: unknown, signal: AbortSignal) => Promise<string | AgentToolResult>;
  validate?: (args: unknown, context: ToolValidationContext) => Promise<string | null>;
}

interface AgentToolResult {
  content: string;
  metadata?: Record<string, unknown>;
  isError?: boolean;
}

interface ToolValidationContext {
  threadId: string;
  recentMessages: number;
}
```

---

## AgentSkill

```typescript
interface AgentSkill {
  name: string;
  description: string;
  instructions: string;
  tools?: AgentTool[];
  match?: (input: string, context: SkillMatchContext) => boolean;
  triggerPrefix?: string;
  priority?: number;
  exclusive?: boolean;
}

interface SkillMatchContext {
  threadId: string;
  recentMessages: number;
}
```

---

## AgentEvent

Discriminated union by `type` field.

```typescript
type AgentEvent =
  | { type: 'agent_start'; traceId: string; threadId: string; model: string }
  | { type: 'text_delta'; content: string }
  | { type: 'text_done'; content: string }
  | { type: 'tool_call_start'; toolCall: ToolCall }
  | { type: 'tool_call_delta'; toolCallId: string; argumentsDelta: string }
  | { type: 'tool_call_end'; toolCallId: string; result: AgentToolResult; duration: number }
  | { type: 'memory_extracted'; memoryId: string; content: string }
  | { type: 'knowledge_retrieved'; chunks: number; topScore: number }
  | { type: 'skill_activated'; skillName: string }
  | { type: 'turn_start'; iteration: number }
  | { type: 'turn_end'; iteration: number; hasToolCalls: boolean }
  | { type: 'error'; error: Error; recoverable: boolean }
  | { type: 'warning'; message: string; code: string }
  | { type: 'agent_end'; traceId: string; usage: TokenUsage; reason: string; duration: number };
```

---

## Data Types

### ChatMessage

```typescript
interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentPart[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  pinned?: boolean;
  createdAt: number;
}
```

### ContentPart

```typescript
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };
```

### ToolCall

```typescript
interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
```

### TokenUsage

```typescript
interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
```

### Memory

```typescript
interface Memory {
  id: string;
  content: string;
  scope: 'thread' | 'persistent' | 'learned';
  category: 'fact' | 'preference' | 'procedure' | 'insight' | 'context';
  confidence: number;       // 0.0 - 1.0
  accessCount: number;
  source: 'extracted' | 'explicit' | 'feedback';
  threadId?: string;
  embedding?: Float32Array;
  createdAt: number;
  lastAccessedAt: number;
  state: 'active' | 'reinforced' | 'decaying' | 'consolidated' | 'expired' | 'removed';
}
```

### KnowledgeDocument

```typescript
interface KnowledgeDocument {
  content: string;
  metadata?: Record<string, unknown>;
}
```

### KnowledgeChunk

```typescript
interface KnowledgeChunk {
  id: string;
  content: string;
  embedding: Float32Array;
  metadata?: Record<string, unknown>;
  createdAt: number;
}
```

### RetrievedKnowledge

```typescript
interface RetrievedKnowledge {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}
```

---

## Store Interfaces

### MemoryStore

```typescript
interface MemoryStore {
  save(memory: Memory): Memory;
  search(query: string, options?: MemorySearchOptions): Memory[];
  findById(id: string): Memory | null;
  incrementAccess(id: string): void;
  deleteLowConfidence(minConfidence: number): number;
  listByScope(scope: string, threadId?: string): Memory[];
}

interface MemorySearchOptions {
  limit?: number;
  scope?: string;
  threadId?: string;
  minConfidence?: number;
  embedding?: Float32Array;
}
```

### VectorStore

```typescript
interface VectorStore {
  upsert(chunk: KnowledgeChunk): void;
  search(queryEmbedding: Float32Array, topK: number): RetrievedKnowledge[];
  delete(id: string): void;
  listAll(): KnowledgeChunk[];
  deleteBySource(sourceId: string): void;
}
```

### ConversationStore

```typescript
interface ConversationStore {
  appendMessage(message: ChatMessage, threadId: string): void;
  listThread(threadId: string): ChatMessage[];
  listPinned(threadId: string): ChatMessage[];
  clearThread(threadId: string): void;
}
```

---

## MCP Types

### MCPConnectionConfig

```typescript
interface MCPConnectionConfig {
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  timeout?: number;           // default: 30_000
  maxRetries?: number;         // default: 3
  healthCheckInterval?: number; // default: 60_000
  isolateErrors?: boolean;     // default: true
}
```

### MCPHealthStatus

```typescript
interface MCPHealthStatus {
  servers: Array<{
    name: string;
    status: 'connected' | 'disconnected' | 'error' | 'reconnecting';
    lastError?: string;
    toolCount: number;
    uptime: number;
  }>;
}
```

---

## Utility Exports

### createLogger

```typescript
function createLogger(options?: { level?: LogLevel; prefix?: string }): Logger;

interface Logger {
  level: LogLevel;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(prefix: string): Logger;
}
```

### LRUCache

```typescript
class LRUCache<K, V> {
  constructor(options: { maxSize: number; ttl?: number });
  get size(): number;
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
}
```

### retry

```typescript
function retry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>;

interface RetryOptions {
  maxRetries: number;
  initialDelay?: number;       // default: 1000
  backoffMultiplier?: number;  // default: 2
  maxDelay?: number;           // default: 30_000
  signal?: AbortSignal;
  isRetryable?: (error: unknown) => boolean;
}
```

### estimateTokens

```typescript
function estimateTokens(text: string): number;
```

Heuristic: ~4 chars/token for Latin, ~1.5 chars/token for CJK.

---

## Enums

```typescript
type MessageRole = 'user' | 'assistant' | 'system' | 'tool';
type MemoryScope = 'thread' | 'persistent' | 'learned';
type MemoryCategory = 'fact' | 'preference' | 'procedure' | 'insight' | 'context';
type MemorySource = 'extracted' | 'explicit' | 'feedback';
type MemoryState = 'active' | 'reinforced' | 'decaying' | 'consolidated' | 'expired' | 'removed';
type ReactLoopState = 'idle' | 'streaming' | 'executing_tools' | 'completed' | 'error' | 'cost_limited' | 'aborted';
type AgentSessionState = 'initializing' | 'ready' | 'executing' | 'cost_exhausted' | 'destroying' | 'destroyed';
type MCPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';
type OnToolError = 'continue' | 'stop' | 'retry';
type OnLimitReached = 'stop' | 'warn';
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
type ResponseFormatType = 'text' | 'json_object' | 'json_schema';
```

### Constants

```typescript
const REACT_LOOP_TERMINAL_STATES: ReadonlySet<ReactLoopState>;
// Set { 'completed', 'error', 'cost_limited', 'aborted' }
```
