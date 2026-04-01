# MCP Integration

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) allows the agent to connect to external tool servers. Instead of defining tools in code, MCP servers expose tools dynamically via a standardized protocol.

---

## Prerequisites

```bash
npm install @modelcontextprotocol/sdk
```

MCP is optional. If the SDK is not installed, `connectMCP()` throws a clear error message.

---

## Connecting a Server

### stdio Transport (local process)

```typescript
const agent = Agent.create({ apiKey: '...' });

await agent.connectMCP({
  name: 'filesystem',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/user/projects'],
});
```

### SSE Transport (remote server)

```typescript
await agent.connectMCP({
  name: 'remote-tools',
  transport: 'sse',
  url: 'http://localhost:3001/sse',
});
```

### SSE with Authentication (headers)

Many remote MCP servers require authentication. Use the `headers` option to pass tokens or API keys:

```typescript
await agent.connectMCP({
  name: 'private-server',
  transport: 'sse',
  url: 'https://mcp.example.com/sse',
  headers: {
    'Authorization': `Bearer ${process.env.MCP_API_TOKEN}`,
  },
});
```

You can pass any custom headers:

```typescript
await agent.connectMCP({
  name: 'enterprise-tools',
  transport: 'sse',
  url: 'https://internal.corp.com/mcp/sse',
  headers: {
    'Authorization': 'Bearer eyJhbGciOiJSUzI1NiIs...',
    'X-Tenant-Id': 'acme-corp',
    'X-Request-Source': 'pure-agent',
  },
});
```

Headers are sent with every request to the SSE server, including the initial connection and all `tools/call` invocations.

### Via Config (auto-connect on creation)

```typescript
const agent = Agent.create({
  apiKey: '...',
  mcp: [
    {
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    },
    {
      name: 'private-api',
      transport: 'sse',
      url: 'https://mcp.example.com/sse',
      headers: {
        'Authorization': `Bearer ${process.env.MCP_API_TOKEN}`,
      },
    },
  ],
});
```

---

## How It Works

1. **Connect** — The adapter spawns a process (stdio) or opens an HTTP connection (SSE)
2. **Discover** — Calls `tools/list` to get available tools from the server
3. **Convert** — Each MCP tool is converted to an `AgentTool` with:
   - Name: `mcp__{serverName}__{toolName}` (e.g., `mcp__filesystem__read_file`)
   - Parameters: JSON Schema → Zod conversion (best-effort)
   - Execute: delegates to the MCP server via `tools/call`
4. **Register** — Tools are registered in the `ToolExecutor`
5. **Use** — The LLM can now call these tools like any other tool

---

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | **required** | Unique server identifier |
| `transport` | `'stdio' \| 'sse'` | **required** | Connection protocol |
| `command` | `string` | required for stdio | Shell command to start the server |
| `args` | `string[]` | `[]` | Command arguments |
| `url` | `string` | required for sse | Server URL |
| `headers` | `Record<string, string>` | `undefined` | HTTP headers for SSE transport (auth tokens, API keys) |
| `timeout` | `number` | `30,000` | Per-tool-call timeout (ms) |
| `maxRetries` | `number` | `3` | Reconnection attempts |
| `healthCheckInterval` | `number` | `60,000` | Health check polling (ms, 0 = off) |
| `isolateErrors` | `boolean` | `true` | Catch tool errors instead of throwing |

---

## Disconnecting

```typescript
// Disconnect a specific server
await agent.disconnectMCP('filesystem');

// All servers disconnect automatically on agent.destroy()
await agent.destroy();
```

When disconnecting, all tools from that server are unregistered from the `ToolExecutor`.

---

## Health Monitoring

```typescript
const health = agent.getHealth();

for (const server of health.servers) {
  console.log(`${server.name}: ${server.status}`);
  console.log(`  Tools: ${server.toolCount}`);
  console.log(`  Uptime: ${Math.round(server.uptime / 1000)}s`);
  if (server.lastError) console.log(`  Error: ${server.lastError}`);
}
```

### Status Values

| Status | Description |
|--------|-------------|
| `connected` | Server is healthy and tools are available |
| `disconnected` | Server was disconnected or failed all reconnection attempts |
| `error` | Health check failed, reconnection pending |
| `reconnecting` | Actively attempting to reconnect |

---

## Fault Isolation

### Per-Tool Errors (`isolateErrors: true`, default)

When a single MCP tool fails, only that tool returns an error. Other tools from the same server continue working.

```typescript
// Tool A fails → error returned as tool_result to LLM
// Tool B from same server → still works normally
```

### Server-Level Recovery

If the entire MCP server goes down:

1. Health check detects the failure
2. Status changes to `reconnecting`
3. Adapter retries with exponential backoff (up to `maxRetries`)
4. If reconnection succeeds, tools are restored
5. If all retries fail, tools are unregistered and status is `disconnected`

---

## Multiple Servers

```typescript
const agent = Agent.create({ apiKey: '...' });

await agent.connectMCP({
  name: 'filesystem',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
});

await agent.connectMCP({
  name: 'github',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
});

// Both sets of tools are now available to the LLM
// filesystem tools: mcp__filesystem__read_file, mcp__filesystem__write_file, ...
// github tools: mcp__github__create_issue, mcp__github__search_repos, ...
```

---

## Tool Naming

MCP tools are namespaced to avoid conflicts:

```
mcp__{serverName}__{originalToolName}
```

Examples:
- `mcp__filesystem__read_file`
- `mcp__github__create_issue`
- `mcp__database__query`

The LLM sees and uses these namespaced names in tool calls.
