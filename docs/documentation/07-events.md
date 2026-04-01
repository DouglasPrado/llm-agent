# Streaming Events

Every `stream()` call returns an `AsyncIterableIterator<AgentEvent>`. Events are the primary way to observe what the agent is doing in real-time.

---

## Event Flow

### Simple text response

```
agent_start → turn_start → text_delta → text_delta → ... → text_done → turn_end → agent_end
```

### With tool calls (multi-turn)

```
agent_start
  → turn_start(0) → tool_call_start → tool_call_end → turn_end(0)
  → turn_start(1) → text_delta → ... → text_done → turn_end(1)
→ agent_end
```

---

## All Event Types

### `agent_start`

Emitted once at the beginning of every `stream()` call.

```typescript
{
  type: 'agent_start',
  traceId: string,    // Unique ID for this execution
  threadId: string,   // Conversation thread
  model: string,      // Model being used
}
```

### `text_delta`

Emitted for each token/chunk of text from the LLM. This is what you render in a chat UI.

```typescript
{
  type: 'text_delta',
  content: string,    // Text fragment
}
```

### `text_done`

Emitted when the LLM finishes generating text for a turn.

```typescript
{
  type: 'text_done',
  content: string,    // Complete text of this turn
}
```

### `tool_call_start`

Emitted when the LLM requests a tool call.

```typescript
{
  type: 'tool_call_start',
  toolCall: {
    id: string,
    type: 'function',
    function: {
      name: string,
      arguments: string,   // JSON string
    },
  },
}
```

### `tool_call_delta`

Emitted during streaming of tool call arguments (incremental).

```typescript
{
  type: 'tool_call_delta',
  toolCallId: string,
  argumentsDelta: string,
}
```

### `tool_call_end`

Emitted after a tool finishes executing.

```typescript
{
  type: 'tool_call_end',
  toolCallId: string,
  result: {
    content: string,
    metadata?: Record<string, unknown>,
    isError?: boolean,
  },
  duration: number,   // Execution time in ms
}
```

### `memory_extracted`

Emitted when a memory is automatically extracted from the conversation.

```typescript
{
  type: 'memory_extracted',
  memoryId: string,
  content: string,
}
```

### `knowledge_retrieved`

Emitted when RAG knowledge is injected into the context.

```typescript
{
  type: 'knowledge_retrieved',
  chunks: number,     // Number of chunks retrieved
  topScore: number,   // Highest similarity score
}
```

### `skill_activated`

Emitted when a skill matches and is activated for this call.

```typescript
{
  type: 'skill_activated',
  skillName: string,
}
```

### `turn_start` / `turn_end`

Mark the beginning and end of each ReAct loop iteration.

```typescript
// Start
{ type: 'turn_start', iteration: number }

// End
{ type: 'turn_end', iteration: number, hasToolCalls: boolean }
```

### `error`

Emitted when an error occurs during execution.

```typescript
{
  type: 'error',
  error: Error,
  recoverable: boolean,   // true = loop will continue, false = fatal
}
```

### `warning`

Emitted for non-fatal issues (cost limits, max iterations, truncation).

```typescript
{
  type: 'warning',
  message: string,
  code: string,            // 'cost_warning' | 'max_iterations' | 'truncated'
}
```

### `agent_end`

Emitted once at the end of every `stream()` call. Always the last event.

```typescript
{
  type: 'agent_end',
  traceId: string,
  usage: {
    inputTokens: number,
    outputTokens: number,
    totalTokens: number,
  },
  reason: 'stop' | 'cost_limit' | 'max_iterations' | 'error' | 'abort',
  duration: number,        // Total execution time in ms
}
```

---

## Usage Patterns

### Chat UI (render text in real-time)

```typescript
for await (const event of agent.stream(userMessage)) {
  if (event.type === 'text_delta') {
    appendToUI(event.content);
  }
}
```

### Logging / Observability

```typescript
for await (const event of agent.stream(userMessage)) {
  switch (event.type) {
    case 'agent_start':
      logger.info('Execution started', { traceId: event.traceId });
      break;
    case 'tool_call_start':
      logger.info('Tool called', { tool: event.toolCall.function.name });
      break;
    case 'tool_call_end':
      logger.info('Tool completed', {
        tool: event.toolCallId,
        duration: event.duration,
        isError: event.result.isError,
      });
      break;
    case 'error':
      logger.error('Error', { error: event.error.message, recoverable: event.recoverable });
      break;
    case 'agent_end':
      logger.info('Execution complete', {
        reason: event.reason,
        tokens: event.usage.totalTokens,
        duration: event.duration,
      });
      break;
  }
}
```

### Cost Monitoring

```typescript
for await (const event of agent.stream(userMessage)) {
  if (event.type === 'agent_end') {
    const cost = estimateCost(event.usage);
    if (cost > budget) {
      await agent.destroy();
      throw new Error('Budget exceeded');
    }
  }
}
```

### Abort / Cancel

```typescript
const controller = new AbortController();

// Cancel after 10 seconds
setTimeout(() => controller.abort(), 10_000);

for await (const event of agent.stream(userMessage, { signal: controller.signal })) {
  // Events stop when aborted
  // agent_end will have reason: 'abort'
}
```
