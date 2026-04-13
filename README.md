# AgentX SDK

TypeScript library for building conversational agents with LLMs. Streaming-first, tools, memory, knowledge/RAG, skills and MCP — all in-process, no frameworks.

```bash
npm install agentx-sdk
```

## Quick Start

```typescript
import { Agent } from 'agentx-sdk';

// Works with any OpenAI-compatible API (OpenRouter, OpenAI, Azure, Groq, etc.)
const agent = Agent.create({
  apiKey: process.env.LLM_API_KEY!,
  // baseUrl: 'https://api.openai.com/v1',  // optional — defaults to OpenRouter
  // model: 'gpt-4o',                        // optional — defaults to Claude Sonnet
});

// Simple chat
const response = await agent.chat('What is the capital of France?');

// Streaming
for await (const event of agent.stream('Explain recursion')) {
  if (event.type === 'text_delta') process.stdout.write(event.content);
}

// Separate embedding provider (e.g. OpenAI direct for lower latency)
const agentWithEmbeddings = Agent.create({
  apiKey: process.env.LLM_API_KEY!,
  embedding: {
    apiKey: process.env.OPENAI_API_KEY!,
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
  },
});
```

## Tools

```typescript
import { z } from 'zod';

agent.addTool({
  name: 'weather',
  description: 'Get current weather for a city',
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => {
    const res = await fetch(`https://api.weather.com/${city}`);
    return await res.text();
  },
});

await agent.chat('What is the weather in Sao Paulo?');
// The agent decides to call the tool automatically
```

### Builtin Tools

The SDK includes ready-to-use tools — filesystem, shell, web and interaction:

```typescript
import { Agent, builtinTools } from 'agentx-sdk';

const agent = Agent.create({ apiKey: '...' });

// Register all (except askUser which needs a callback)
builtinTools.all().forEach(t => agent.addTool(t));

// Or register individually
agent.addTool(builtinTools.fileRead());
agent.addTool(builtinTools.fileWrite());
agent.addTool(builtinTools.fileEdit());
agent.addTool(builtinTools.glob());
agent.addTool(builtinTools.grep());
agent.addTool(builtinTools.bash());
agent.addTool(builtinTools.webFetch());

// askUser needs a callback — you implement the interaction
agent.addTool(builtinTools.askUser({
  onAsk: async (question, options) => {
    // Your logic (readline, UI, API, etc.)
    return readline.question(question);
  },
}));

// Shortcut: file ops only (read + write + edit + glob + grep)
builtinTools.fileOps().forEach(t => agent.addTool(t));
```

| Tool | Name | Description |
|------|------|-------------|
| `builtinTools.fileRead()` | Read | Read files with line numbers and offset/limit |
| `builtinTools.fileWrite()` | Write | Write/create files (creates dirs automatically) |
| `builtinTools.fileEdit()` | Edit | Exact find/replace in files |
| `builtinTools.glob()` | Glob | Search files by pattern (`**/*.ts`) |
| `builtinTools.grep()` | Grep | Search content via regex in files |
| `builtinTools.bash()` | Bash | Execute shell commands with timeout |
| `builtinTools.webFetch()` | WebFetch | Fetch content from URL (HTML → text) |
| `builtinTools.askUser()` | AskUser | Ask the user a question (callback pattern) |

## Skills

Skills are modular behaviors that modify the agent when activated. Unlike tools (which the LLM calls to obtain data), skills **inject instructions into the context** to guide LLM behavior.

### Programmatic skill

```typescript
agent.addSkill({
  name: 'code-review',
  description: 'Reviews code for quality and bugs',
  instructions: `You are in code review mode.
    Analyze for bugs, security issues, and performance.
    Rate quality from 1-10.`,
  triggerPrefix: '/review',
});

await agent.chat('/review function add(a, b) { return a + b; }');
```

### Skill with arguments

```typescript
agent.addSkill({
  name: 'translate',
  description: 'Translates text to a target language',
  instructions: 'Translate the following to $lang: $ARGS',
  argNames: ['lang'],
  triggerPrefix: '/translate',
});

// $lang = "pt", $ARGS = "Hello world"
await agent.chat('/translate pt Hello world');
```

### Skill with dynamic prompt

```typescript
agent.addSkill({
  name: 'explain',
  description: 'Explains code at different levels',
  instructions: '',
  triggerPrefix: '/explain',
  argNames: ['level'],
  getPrompt: async (args, ctx) => {
    const level = args.split(' ')[0] || 'intermediate';
    return `Explain for a ${level} developer. Thread: ${ctx.threadId}`;
  },
});

await agent.chat('/explain beginner What is a closure?');
```

### Skill with its own tools

Tools registered in the skill are activated **only when the skill is active** and removed at the end of the turn.

```typescript
agent.addSkill({
  name: 'file-manager',
  description: 'File management operations',
  instructions: 'You can read files using the read_file tool.',
  triggerPrefix: '/files',
  tools: [
    {
      name: 'read_file',
      description: 'Read a file from disk',
      parameters: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const fs = await import('fs/promises');
        return fs.readFile(path as string, 'utf-8');
      },
    },
  ],
});
```

### Skill with model discovery (whenToUse)

Skills with `whenToUse` are listed in the model context so it can proactively suggest them.

```typescript
agent.addSkill({
  name: 'deploy',
  description: 'Deploy to production',
  whenToUse: 'When user mentions deploy, release, ship, or push to prod',
  instructions: 'Guide the user through deployment steps...',
  // No triggerPrefix — activates via semantic matching or model suggestion
});
```

### Skill via SKILL.md file

Create markdown files with YAML frontmatter in a directory:

```
.skills/
  code-review/
    SKILL.md
  translate/
    SKILL.md
```

**`.skills/code-review/SKILL.md`:**

```markdown
---
name: code-review
description: Reviews code for quality and bugs
whenToUse: When user asks to review, audit, or check code quality
triggerPrefix: /review
aliases: [cr, audit]
argNames: [file]
allowedTools: [Read, Grep]
priority: 8
---

You are in code review mode.
Review $file for bugs, security issues, and performance.
Skill directory: ${SKILL_DIR}
```

**Loading:**

```typescript
// Via config (auto-load in constructor)
const agent = Agent.create({
  apiKey: '...',
  skills: { skillsDir: './.skills' },
});

// Or manually
await agent.loadSkillsDir('./.skills');
```

### Conditional skill (path-activated)

Skills with `paths` remain inactive until a matching file is touched.

```typescript
agent.addSkill({
  name: 'ts-linter',
  description: 'TypeScript linting rules',
  instructions: 'Apply strict TypeScript linting...',
  paths: ['src/**/*.ts', 'tests/**/*.ts'],
  match: () => true,
});

// Activates when a file is touched
agent.activateSkillsForPaths(['src/agent.ts']);
```

### Exclusive skill

```typescript
agent.addSkill({
  name: 'focus-mode',
  description: 'Deep focus on a single task',
  instructions: 'Focus exclusively on the current task.',
  triggerPrefix: '/focus',
  exclusive: true, // blocks all other skills
});
```

### Frontmatter reference (SKILL.md)

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Unique skill name |
| `description` | string | Short description |
| `whenToUse` | string | Usage scenarios (for model discovery) |
| `triggerPrefix` | string | Activation prefix (e.g. `/review`) |
| `aliases` | string[] | Alternative names |
| `argNames` | string[] | Argument names for substitution |
| `allowedTools` | string[] | Tools the skill can use |
| `model` | string | Model override |
| `context` | `inline` \| `fork` | Execution mode |
| `paths` | string[] | Globs for conditional activation |
| `effort` | number | Computational effort hint (1-10) |
| `exclusive` | boolean | Blocks other skills |
| `priority` | number | Priority (higher wins) |
| `modelInvocable` | boolean | Whether the model can invoke (default: true) |

### Skills API

```typescript
agent.addSkill(skill)                          // register
agent.removeSkill('name')                      // remove
agent.listSkills()                             // list
await agent.loadSkillsDir('./skills')          // load from directory
agent.activateSkillsForPaths(['file.ts'])      // activate conditionals
```

### Matching hierarchy

Skills are evaluated at 4 levels (most specific first):

1. **Prefix** — `input.startsWith(triggerPrefix)` (score 1.0)
2. **Alias** — `input.startsWith(/alias)` (score 0.95)
3. **Custom** — `skill.match(input)` returns true (score 0.8)
4. **Semantic** — cosine similarity > 0.7 with `description + whenToUse` (requires EmbeddingService)

Maximum of 3 simultaneously active skills (configurable via `skills.maxActiveSkills`).

## Memory

Persistent file-based memory system inspired by Claude Code.

```typescript
// Save memory explicitly
await agent.remember('User prefers dark mode', 'user');

// Search relevant memories
const memories = await agent.recall('What are the user preferences?');

// Automatic extraction: after each turn, the agent extracts memories
// from the conversation in the background (fire-and-forget)
```

Memories are `.md` files with YAML frontmatter in `~/.agent/memory/` (configurable). Four types: `user`, `feedback`, `project`, `reference`.

## Knowledge (RAG)

```typescript
await agent.ingestKnowledge({
  id: 'docs-api',
  content: apiDocs,
  metadata: { source: 'api-docs.md' },
});

// The agent automatically searches knowledge when relevant
await agent.chat('How do I authenticate with the API?');
```

## MCP (Model Context Protocol)

Connect to any MCP server to extend agent capabilities with external tools, resources and prompts.

### Basic connection

```typescript
await agent.connectMCP({
  name: 'github',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
});

// Server tools are registered automatically (mcp__github__create_issue, etc.)
await agent.chat('List my open PRs');
await agent.disconnectMCP('github');
```

### Supported transports

```typescript
// Stdio — local subprocess (Node, Python, Rust MCP servers)
await agent.connectMCP({
  name: 'local-server',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
});

// SSE — Server-Sent Events (long-lived connection)
await agent.connectMCP({
  name: 'remote-sse',
  transport: 'sse',
  url: 'https://mcp.example.com/sse',
  headers: { 'Authorization': 'Bearer sk-...' },
});

// HTTP — Streamable HTTP (modern servers, bidirectional)
await agent.connectMCP({
  name: 'remote-http',
  transport: 'http',
  url: 'https://mcp.example.com/v1',
  headers: { 'Authorization': 'Bearer sk-...' },
});
```

### Automatic tool annotations

MCP servers that declare `readOnlyHint` or `destructiveHint` in tools are automatically mapped to AgentTool flags:

| MCP Annotation | AgentTool Flag | Effect |
|---|---|---|
| `readOnlyHint: true` | `isReadOnly: true` + `isConcurrencySafe: true` | Tools run in parallel, no warning |
| `destructiveHint: true` | `isDestructive: true` | Model receives caution warning |

### Server instructions

If the MCP server returns `instructions` in the handshake, they are automatically injected into the model context — the agent follows the server's guidance.

### MCP Prompts as Skills

Prompts that the MCP server offers via `prompts/list` are automatically registered as skills. The model can invoke them via SkillTool:

```typescript
await agent.connectMCP({
  name: 'docs',
  transport: 'stdio',
  command: 'npx',
  args: ['my-docs-server'],
});

// If the server has a "summarize" prompt, it becomes a skill: mcp__docs__summarize
// The model can call: Skill({ skill: "mcp__docs__summarize", args: "..." })
```

### Resources

```typescript
// List available resources from a server
const resources = await agent.mcpAdapter.listResources('github');
// [{ uri: 'repo://owner/project', name: 'Project', serverName: 'github' }]

// Read resource content
const content = await agent.mcpAdapter.readResource('github', 'repo://owner/project');
```

### Full configuration

```typescript
await agent.connectMCP({
  name: 'my-server',
  transport: 'stdio',           // 'stdio' | 'sse' | 'http'
  command: 'npx',               // for stdio
  args: ['-y', 'my-mcp-server'],
  // url: 'https://...',        // for sse/http
  // headers: { ... },          // for sse/http
  timeout: 30_000,              // timeout per tool call (ms)
  maxRetries: 3,                // reconnection attempts
  healthCheckInterval: 60_000,  // periodic health check (ms)
  isolateErrors: true,          // errors don't propagate (default: true)
});
```

### Health monitoring

```typescript
const health = agent.getHealth();
// {
//   servers: [{
//     name: 'github',
//     status: 'connected',    // 'connected' | 'disconnected' | 'error' | 'reconnecting'
//     toolCount: 15,
//     uptime: 120000
//   }]
// }
```

### Deep JSON Schema

MCP tools with complex schemas (nested objects, arrays, enums) are automatically converted to Zod — works with GitHub, Slack, and any server that uses rich schemas:

```typescript
// This works automatically — nested schema converted to Zod
await agent.chat('Create a GitHub issue with labels bug and urgent');
// LLM calls: mcp__github__create_issue({
//   owner: "user", repo: "project",
//   title: "...", labels: ["bug", "urgent"]
// })
```

## Streaming Events

```typescript
for await (const event of agent.stream('Build a TODO app')) {
  switch (event.type) {
    case 'agent_start':      // Execution started
    case 'skill_activated':  // Skill activated (event.skillName)
    case 'text_delta':       // Text chunk (event.content)
    case 'text_done':        // Full text complete
    case 'tool_call_start':  // Tool called
    case 'tool_call_end':    // Tool result
    case 'turn_start':       // Loop iteration started
    case 'turn_end':         // Loop iteration ended
    case 'agent_end':        // Finished (event.usage, event.duration)
    case 'error':            // Error (event.recoverable)
    case 'warning':          // Warning
    case 'compaction':       // Context compacted
    case 'recovery':         // Automatic recovery
    case 'model_fallback':   // Model fallback
  }
}
```

## Configuration

```typescript
const agent = Agent.create({
  apiKey: 'sk-...',
  baseUrl: 'https://api.openai.com/v1',   // optional — any OpenAI-compatible URL
  model: 'gpt-4o',
  systemPrompt: 'You are a helpful assistant.',

  // Separate embedding provider (optional)
  embedding: {
    apiKey: 'sk-...',
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
  },

  // Skills
  skills: {
    skillsDir: './.skills',     // Auto-load skills from directory
    maxActiveSkills: 3,         // Max simultaneous skills
    modelDiscovery: true,       // List skills for model context
  },

  // Memory
  memory: {
    enabled: true,
    memoryDir: '~/.agent/memory/',
    extractionEnabled: true,
    samplingRate: 0.3,          // 30% chance per turn
    extractionInterval: 10,     // Force every 10 turns
  },

  // Knowledge
  knowledge: {
    enabled: true,
    chunkSize: 512,
    topK: 5,
    minScore: 0.3,
  },

  // Behavior
  maxIterations: 10,
  onToolError: 'continue',     // 'continue' | 'stop' | 'retry'

  // Cost control
  costPolicy: {
    maxTokensPerExecution: 50_000,
    onLimitReached: 'stop',
  },

  // Context
  maxContextTokens: 128_000,
  compactionThreshold: 0.8,

  // Recovery
  fallbackModel: 'anthropic/claude-haiku-4-5-20251001',
  maxOutputTokens: 4096,
  escalatedMaxOutputTokens: 16384,

  // Observability
  logLevel: 'info',
});
```

## Pluggable Stores

```typescript
import { Agent } from 'agentx-sdk';

// Custom conversation store (e.g. PostgreSQL)
const agent = Agent.create({
  apiKey: '...',
  conversation: { store: myPostgresConversationStore },
  knowledge: { store: myPineconeVectorStore },
});
```

Interfaces: `ConversationStore`, `VectorStore` — implement to use any backend.

## Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.x |
| Runtime | Node.js 22+ |
| Validation | Zod 3.x |
| Persistence | better-sqlite3 + SQLite |
| Tools schema | zod-to-json-schema |
| LLM | Any OpenAI-compatible API (native fetch) |

**<= 4 direct dependencies.** Zero AI frameworks. No vendor lock-in.

## License

MIT

---

<details>
<summary><h1>Portugues</h1></summary>

# AgentX SDK

Biblioteca TypeScript para construir agentes conversacionais com LLM. Streaming-first, tools, memory, knowledge/RAG, skills e MCP — tudo in-process, sem frameworks.

```bash
npm install agentx-sdk
```

## Quick Start

```typescript
import { Agent } from 'agentx-sdk';

// Funciona com qualquer API OpenAI-compatible (OpenRouter, OpenAI, Azure, Groq, etc.)
const agent = Agent.create({
  apiKey: process.env.LLM_API_KEY!,
  // baseUrl: 'https://api.openai.com/v1',  // opcional — default: OpenRouter
});

// Chat simples
const response = await agent.chat('Qual a capital da Franca?');

// Streaming
for await (const event of agent.stream('Explique recursao')) {
  if (event.type === 'text_delta') process.stdout.write(event.content);
}
```

## Tools

```typescript
import { z } from 'zod';

agent.addTool({
  name: 'weather',
  description: 'Get current weather for a city',
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => {
    const res = await fetch(`https://api.weather.com/${city}`);
    return await res.text();
  },
});

await agent.chat('Qual o clima em Sao Paulo?');
// O agente decide chamar a tool automaticamente
```

### Builtin Tools

O SDK inclui tools prontas para uso — filesystem, shell, web e interacao:

```typescript
import { Agent, builtinTools } from 'agentx-sdk';

const agent = Agent.create({ apiKey: '...' });

// Registrar todas (exceto askUser que precisa de callback)
builtinTools.all().forEach(t => agent.addTool(t));

// Ou registrar individualmente
agent.addTool(builtinTools.fileRead());
agent.addTool(builtinTools.fileWrite());
agent.addTool(builtinTools.fileEdit());
agent.addTool(builtinTools.glob());
agent.addTool(builtinTools.grep());
agent.addTool(builtinTools.bash());
agent.addTool(builtinTools.webFetch());

// askUser precisa de callback — voce implementa a interacao
agent.addTool(builtinTools.askUser({
  onAsk: async (question, options) => {
    // Sua logica (readline, UI, API, etc.)
    return readline.question(question);
  },
}));

// Atalho: so file ops (read + write + edit + glob + grep)
builtinTools.fileOps().forEach(t => agent.addTool(t));
```

| Tool | Nome | Descricao |
|------|------|-----------|
| `builtinTools.fileRead()` | Read | Ler arquivos com line numbers e offset/limit |
| `builtinTools.fileWrite()` | Write | Escrever/criar arquivos (cria dirs automaticamente) |
| `builtinTools.fileEdit()` | Edit | Find/replace exato em arquivos |
| `builtinTools.glob()` | Glob | Buscar arquivos por pattern (`**/*.ts`) |
| `builtinTools.grep()` | Grep | Buscar conteudo via regex em arquivos |
| `builtinTools.bash()` | Bash | Executar comandos shell com timeout |
| `builtinTools.webFetch()` | WebFetch | Buscar conteudo de URL (HTML → texto) |
| `builtinTools.askUser()` | AskUser | Perguntar ao usuario (callback pattern) |

## Skills

Skills sao comportamentos modulares que modificam o agente quando ativados. Diferente de tools (que o LLM chama para obter dados), skills **injetam instrucoes no contexto** para guiar o comportamento do LLM.

### Skill programatica

```typescript
agent.addSkill({
  name: 'code-review',
  description: 'Reviews code for quality and bugs',
  instructions: `You are in code review mode.
    Analyze for bugs, security issues, and performance.
    Rate quality from 1-10.`,
  triggerPrefix: '/review',
});

await agent.chat('/review function add(a, b) { return a + b; }');
```

### Skill com argumentos

```typescript
agent.addSkill({
  name: 'translate',
  description: 'Translates text to a target language',
  instructions: 'Translate the following to $lang: $ARGS',
  argNames: ['lang'],
  triggerPrefix: '/translate',
});

// $lang = "pt", $ARGS = "Hello world"
await agent.chat('/translate pt Hello world');
```

### Skill com prompt dinamico

```typescript
agent.addSkill({
  name: 'explain',
  description: 'Explains code at different levels',
  instructions: '',
  triggerPrefix: '/explain',
  argNames: ['level'],
  getPrompt: async (args, ctx) => {
    const level = args.split(' ')[0] || 'intermediate';
    return `Explain for a ${level} developer. Thread: ${ctx.threadId}`;
  },
});

await agent.chat('/explain beginner What is a closure?');
```

### Skill com tools proprios

Tools registrados na skill sao ativados **apenas quando a skill esta ativa** e removidos ao final do turn.

```typescript
agent.addSkill({
  name: 'file-manager',
  description: 'File management operations',
  instructions: 'You can read files using the read_file tool.',
  triggerPrefix: '/files',
  tools: [
    {
      name: 'read_file',
      description: 'Read a file from disk',
      parameters: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const fs = await import('fs/promises');
        return fs.readFile(path as string, 'utf-8');
      },
    },
  ],
});
```

### Skill com model discovery (whenToUse)

Skills com `whenToUse` sao listadas no contexto do modelo para que ele possa sugeri-las proativamente.

```typescript
agent.addSkill({
  name: 'deploy',
  description: 'Deploy to production',
  whenToUse: 'When user mentions deploy, release, ship, or push to prod',
  instructions: 'Guide the user through deployment steps...',
  // Sem triggerPrefix — ativa por semantic matching ou sugestao do modelo
});
```

### Skill via arquivo SKILL.md

Crie arquivos markdown com frontmatter YAML em um diretorio:

```
.skills/
  code-review/
    SKILL.md
  translate/
    SKILL.md
```

**`.skills/code-review/SKILL.md`:**

```markdown
---
name: code-review
description: Reviews code for quality and bugs
whenToUse: When user asks to review, audit, or check code quality
triggerPrefix: /review
aliases: [cr, audit]
argNames: [file]
allowedTools: [Read, Grep]
priority: 8
---

You are in code review mode.
Review $file for bugs, security issues, and performance.
Skill directory: ${SKILL_DIR}
```

**Carregamento:**

```typescript
// Via config (auto-load no constructor)
const agent = Agent.create({
  apiKey: '...',
  skills: { skillsDir: './.skills' },
});

// Ou manualmente
await agent.loadSkillsDir('./.skills');
```

### Skill condicional (ativa por path)

Skills com `paths` ficam inativas ate que um arquivo matching seja tocado.

```typescript
agent.addSkill({
  name: 'ts-linter',
  description: 'TypeScript linting rules',
  instructions: 'Apply strict TypeScript linting...',
  paths: ['src/**/*.ts', 'tests/**/*.ts'],
  match: () => true,
});

// Ativa quando arquivo e tocado
agent.activateSkillsForPaths(['src/agent.ts']);
```

### Skill exclusiva

```typescript
agent.addSkill({
  name: 'focus-mode',
  description: 'Deep focus on a single task',
  instructions: 'Focus exclusively on the current task.',
  triggerPrefix: '/focus',
  exclusive: true, // bloqueia todas as outras skills
});
```

### Referencia de frontmatter (SKILL.md)

| Campo | Tipo | Descricao |
|-------|------|-----------|
| `name` | string | Nome unico da skill |
| `description` | string | Descricao curta |
| `whenToUse` | string | Cenarios de uso (para model discovery) |
| `triggerPrefix` | string | Prefixo para ativacao (ex: `/review`) |
| `aliases` | string[] | Nomes alternativos |
| `argNames` | string[] | Nomes dos argumentos para substituicao |
| `allowedTools` | string[] | Tools que a skill pode usar |
| `model` | string | Override de modelo |
| `context` | `inline` \| `fork` | Modo de execucao |
| `paths` | string[] | Globs para ativacao condicional |
| `effort` | number | Hint de esforco computacional (1-10) |
| `exclusive` | boolean | Bloqueia outras skills |
| `priority` | number | Prioridade (maior vence) |
| `modelInvocable` | boolean | Se o modelo pode invocar (default: true) |

### API de Skills

```typescript
agent.addSkill(skill)                          // registrar
agent.removeSkill('name')                      // remover
agent.listSkills()                             // listar
await agent.loadSkillsDir('./skills')          // carregar de diretorio
agent.activateSkillsForPaths(['file.ts'])      // ativar condicionais
```

### Hierarquia de matching

Skills sao avaliadas em 4 niveis (mais especifico primeiro):

1. **Prefix** — `input.startsWith(triggerPrefix)` (score 1.0)
2. **Alias** — `input.startsWith(/alias)` (score 0.95)
3. **Custom** — `skill.match(input)` retorna true (score 0.8)
4. **Semantic** — cosine similarity > 0.7 com `description + whenToUse` (requer EmbeddingService)

Maximo de 3 skills ativas simultaneamente (configuravel via `skills.maxActiveSkills`).

## Memory

Sistema de memoria persistente baseado em arquivos markdown (inspirado no Claude Code).

```typescript
// Salvar memoria explicitamente
await agent.remember('User prefers dark mode', 'user');

// Buscar memorias relevantes
const memories = await agent.recall('What are the user preferences?');

// Extracao automatica: apos cada turn, o agente extrai memorias
// da conversa em background (fire-and-forget)
```

Memorias sao arquivos `.md` com frontmatter YAML em `~/.agent/memory/` (configuravel). Quatro tipos: `user`, `feedback`, `project`, `reference`.

## Knowledge (RAG)

```typescript
await agent.ingestKnowledge({
  id: 'docs-api',
  content: apiDocs,
  metadata: { source: 'api-docs.md' },
});

// O agente busca automaticamente no knowledge quando relevante
await agent.chat('How do I authenticate with the API?');
```

## MCP (Model Context Protocol)

Conecte a qualquer MCP server para estender as capacidades do agente com tools, resources e prompts externos.

### Conexao basica

```typescript
await agent.connectMCP({
  name: 'github',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
});

// Tools do server registradas automaticamente (mcp__github__create_issue, etc.)
await agent.chat('Liste meus PRs abertos');
await agent.disconnectMCP('github');
```

### Transports suportados

```typescript
// Stdio — subprocess local (Node, Python, Rust MCP servers)
await agent.connectMCP({
  name: 'local-server',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
});

// SSE — Server-Sent Events (conexao persistente)
await agent.connectMCP({
  name: 'remote-sse',
  transport: 'sse',
  url: 'https://mcp.example.com/sse',
  headers: { 'Authorization': 'Bearer sk-...' },
});

// HTTP — Streamable HTTP (servers modernos, bidirecional)
await agent.connectMCP({
  name: 'remote-http',
  transport: 'http',
  url: 'https://mcp.example.com/v1',
  headers: { 'Authorization': 'Bearer sk-...' },
});
```

### Anotacoes automaticas de tools

MCP servers que declaram `readOnlyHint` ou `destructiveHint` nas tools sao mapeados automaticamente para os flags do AgentTool:

| Anotacao MCP | Flag AgentTool | Efeito |
|---|---|---|
| `readOnlyHint: true` | `isReadOnly: true` + `isConcurrencySafe: true` | Tools executam em paralelo, sem warning |
| `destructiveHint: true` | `isDestructive: true` | Modelo recebe aviso de cautela |

### Instrucoes do server

Se o MCP server retorna `instructions` no handshake, elas sao injetadas automaticamente no contexto do modelo — o agente segue as orientacoes do server.

### MCP Prompts como Skills

Prompts que o MCP server oferece via `prompts/list` sao registrados como skills automaticamente. O modelo pode invoca-los via SkillTool:

```typescript
await agent.connectMCP({
  name: 'docs',
  transport: 'stdio',
  command: 'npx',
  args: ['my-docs-server'],
});

// Se o server tem prompt "summarize", vira skill: mcp__docs__summarize
// O modelo pode chamar: Skill({ skill: "mcp__docs__summarize", args: "..." })
```

### Resources

```typescript
// Listar recursos disponiveis de um server
const resources = await agent.mcpAdapter.listResources('github');
// [{ uri: 'repo://owner/project', name: 'Project', serverName: 'github' }]

// Ler conteudo de um recurso
const content = await agent.mcpAdapter.readResource('github', 'repo://owner/project');
```

### Configuracao completa

```typescript
await agent.connectMCP({
  name: 'my-server',
  transport: 'stdio',           // 'stdio' | 'sse' | 'http'
  command: 'npx',               // para stdio
  args: ['-y', 'my-mcp-server'],
  // url: 'https://...',        // para sse/http
  // headers: { ... },          // para sse/http
  timeout: 30_000,              // timeout por tool call (ms)
  maxRetries: 3,                // tentativas de reconexao
  healthCheckInterval: 60_000,  // health check periodico (ms)
  isolateErrors: true,          // erros nao propagam (default: true)
});
```

### Monitoramento de saude

```typescript
const health = agent.getHealth();
// {
//   servers: [{
//     name: 'github',
//     status: 'connected',    // 'connected' | 'disconnected' | 'error' | 'reconnecting'
//     toolCount: 15,
//     uptime: 120000
//   }]
// }
```

### JSON Schema profundo

Tools MCP com schemas complexos (nested objects, arrays, enums) sao convertidas automaticamente para Zod — funciona com GitHub, Slack, e qualquer server que use schemas ricos:

```typescript
// Isso funciona automaticamente — schema nested convertido para Zod
await agent.chat('Crie uma issue no GitHub com labels bug e urgent');
// LLM chama: mcp__github__create_issue({
//   owner: "user", repo: "project",
//   title: "...", labels: ["bug", "urgent"]
// })
```

## Streaming Events

```typescript
for await (const event of agent.stream('Build a TODO app')) {
  switch (event.type) {
    case 'agent_start':      // Inicio da execucao
    case 'skill_activated':  // Skill ativada (event.skillName)
    case 'text_delta':       // Chunk de texto (event.content)
    case 'text_done':        // Texto completo
    case 'tool_call_start':  // Tool chamada
    case 'tool_call_end':    // Tool resultado
    case 'turn_start':       // Inicio de iteracao do loop
    case 'turn_end':         // Fim de iteracao
    case 'agent_end':        // Fim (event.usage, event.duration)
    case 'error':            // Erro (event.recoverable)
    case 'warning':          // Aviso
    case 'compaction':       // Contexto compactado
    case 'recovery':         // Recovery automatico
    case 'model_fallback':   // Fallback de modelo
  }
}
```

## Configuracao

```typescript
const agent = Agent.create({
  apiKey: 'sk-...',
  baseUrl: 'https://api.openai.com/v1',   // optional — any OpenAI-compatible URL
  model: 'gpt-4o',
  systemPrompt: 'You are a helpful assistant.',

  // Separate embedding provider (optional)
  embedding: {
    apiKey: 'sk-...',
    baseUrl: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
  },

  // Skills
  skills: {
    skillsDir: './.skills',     // Auto-load de skills do diretorio
    maxActiveSkills: 3,         // Max skills simultaneas
    modelDiscovery: true,       // Listar skills no contexto do modelo
  },

  // Memory
  memory: {
    enabled: true,
    memoryDir: '~/.agent/memory/',
    extractionEnabled: true,
    samplingRate: 0.3,          // 30% de chance por turn
    extractionInterval: 10,     // Forcar a cada 10 turns
  },

  // Knowledge
  knowledge: {
    enabled: true,
    chunkSize: 512,
    topK: 5,
    minScore: 0.3,
  },

  // Comportamento
  maxIterations: 10,
  onToolError: 'continue',     // 'continue' | 'stop' | 'retry'

  // Controle de custo
  costPolicy: {
    maxTokensPerExecution: 50_000,
    onLimitReached: 'stop',
  },

  // Contexto
  maxContextTokens: 128_000,
  compactionThreshold: 0.8,

  // Recovery
  fallbackModel: 'anthropic/claude-haiku-4-5-20251001',
  maxOutputTokens: 4096,
  escalatedMaxOutputTokens: 16384,

  // Observabilidade
  logLevel: 'info',
});
```

## Pluggable Stores

```typescript
import { Agent } from 'agentx-sdk';

// Custom conversation store (ex: PostgreSQL)
const agent = Agent.create({
  apiKey: '...',
  conversation: { store: myPostgresConversationStore },
  knowledge: { store: myPineconeVectorStore },
});
```

Interfaces: `ConversationStore`, `VectorStore` — implemente para usar qualquer backend.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Linguagem | TypeScript 5.x |
| Runtime | Node.js 22+ |
| Validacao | Zod 3.x |
| Persistencia | better-sqlite3 + SQLite |
| Tools schema | zod-to-json-schema |
| LLM | Qualquer API OpenAI-compatible (fetch nativo) |

**<= 4 dependencias diretas.** Zero frameworks de IA. Sem vendor lock-in.

## License

MIT

</details>
