# AgentX SDK — Guia de Uso e Arquitetura

## Como usar o framework

A API gira em torno de uma classe `Agent` com dois metodos principais — `.chat()` (retorna string) e `.stream()` (retorna `AsyncIterableIterator<AgentEvent>`). Zero dependencia de frameworks de IA — so `fetch()` nativo para qualquer API OpenAI-compatible (OpenRouter, OpenAI, Azure, Groq, Together, etc.).

```typescript
import { Agent } from "./src/agent";
import { z } from "zod";

// OpenRouter (default)
const agent = new Agent({
  apiKey: "sk-or-...",
  model: "anthropic/claude-sonnet-4",
});

// OpenAI direto
const agent = new Agent({
  apiKey: "sk-...",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o",
});

// OpenRouter para chat + OpenAI direto para embeddings (menor latencia/custo)
const agent = new Agent({
  apiKey: "sk-or-...",
  model: "anthropic/claude-sonnet-4",
  embedding: {
    apiKey: "sk-...",
    baseUrl: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
  },
});
```

### Chat simples

```typescript
const resposta = await agent.chat("Ola, como voce esta?");
console.log(resposta); // string
```

### Streaming (token por token)

```typescript
for await (const ev of agent.stream("Explique quantum computing")) {
  if (ev.type === "text_delta") process.stdout.write(ev.data);
}
```

### Tools (function calling)

```typescript
const agent = new Agent({
  apiKey: "sk-...",
  model: "anthropic/claude-sonnet-4",
  tools: [{
    name: "get_weather",
    description: "Get weather for a city",
    parameters: z.object({ city: z.string() }),
    execute: async ({ city }) => `25C in ${city}`,
  }],
});

await agent.chat("Qual o clima em Sao Paulo?");
// O agente chama get_weather automaticamente e responde com o resultado
```

### Multimodal (imagens)

```typescript
for await (const ev of agent.stream([
  { type: "text", text: "Descreva esta imagem" },
  { type: "image_url", image_url: { url: "https://example.com/foto.jpg" } },
])) {
  if (ev.type === "text_delta") process.stdout.write(ev.data);
}
```

### Structured output (JSON tipado)

```typescript
const json = await agent.chat("List 3 colors", {
  responseFormat: { type: "json_object" },
});
console.log(JSON.parse(json));
```

### Controle de custo

```typescript
const agent = new Agent({
  apiKey: "...",
  model: "...",
  costPolicy: {
    maxTokensPerExecution: 50_000,
    maxTokensPerSession: 500_000,
    onLimitReached: "stop",
  },
});

await agent.chat("Hello");
console.log(agent.getUsage()); // { inputTokens: 150, outputTokens: 50, totalTokens: 200 }
```

---

## Knowledge — Como alimentar a base de conhecimento

```typescript
const agent = new Agent({ apiKey: "...", model: "...", knowledge: true });

await agent.ingestKnowledge({
  content: "Texto longo do documento, FAQ, manual, etc...",
});

await agent.chat("Quanto custa o produto X?"); // responde com base no documento
```

O fluxo interno:

1. **Chunking** — divide o texto em pedacos (fixed-size ou recursive character)
2. **Embedding** — gera vetores via LLM API (OpenRouter, OpenAI direto, ou qualquer provider OpenAI-compatible)
3. **Storage** — salva no SQLite (vetores + conteudo + metadata)

Na hora do `.chat()`, o `ContextPipeline` busca automaticamente os chunks mais relevantes via similaridade cosseno + FTS5 e injeta no contexto do LLM.

Customizacao:

```typescript
const agent = new Agent({
  apiKey: "...",
  model: "...",
  knowledge: {
    chunkSize: 1000,
    chunkOverlap: 128,
    topK: 5,
    minScore: 0.3,
  },
  // Embedding via OpenAI direto (menor latencia para embeddings)
  embedding: {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
  },
});
```

---

## Providers LLM — Configuracao flexivel

O SDK usa um `LLMClient` generico que funciona com qualquer API OpenAI-compatible. Nao ha dependencia de nenhum provider especifico.

### Variaveis de ambiente (examples)

| Variavel | Descricao | Obrigatorio |
|---|---|---|
| `LLM_API_KEY` | API key do provider de chat | Sim |
| `LLM_BASE_URL` | Base URL do provider (default: OpenRouter) | Nao |
| `AGENT_MODEL` | Modelo para chat (default: `anthropic/claude-sonnet-4-20250514`) | Nao |
| `EMBEDDING_API_KEY` | API key para embeddings (default: usa `LLM_API_KEY`) | Nao |
| `EMBEDDING_BASE_URL` | Base URL para embeddings (default: usa `LLM_BASE_URL`) | Nao |
| `EMBEDDING_MODEL` | Modelo de embedding (default: `openai/text-embedding-3-small`) | Nao |

### Cenarios de configuracao

```typescript
// 1. OpenRouter para tudo (default)
Agent.create({
  apiKey: process.env.LLM_API_KEY,
  model: "anthropic/claude-sonnet-4-20250514",
});

// 2. OpenAI direto para tudo
Agent.create({
  apiKey: process.env.LLM_API_KEY,
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o",
  embeddingModel: "text-embedding-3-small",
});

// 3. OpenRouter para chat + OpenAI para embeddings
Agent.create({
  apiKey: process.env.LLM_API_KEY,
  model: "anthropic/claude-sonnet-4-20250514",
  embedding: {
    apiKey: process.env.EMBEDDING_API_KEY,
    baseUrl: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
  },
});
```

### Nota sobre nomes de modelo

O nome do modelo depende do provider:
- **OpenRouter**: usa prefixo do provider — `anthropic/claude-sonnet-4`, `openai/gpt-4o`, `openai/text-embedding-3-small`
- **OpenAI direto**: sem prefixo — `gpt-4o`, `text-embedding-3-small`
- **Outros**: conforme documentacao do provider

---

## MCP — Como conectar servidores externos

```typescript
// Via config no constructor
const agent = new Agent({
  apiKey: "...",
  model: "...",
  mcp: [
    {
      name: "whatsapp",
      transport: "stdio",
      command: "node",
      args: ["mcp-server.js"],
      timeout: 30_000,
      maxRetries: 3,
      healthCheckInterval: 60_000,
      isolateErrors: true,
    },
    {
      name: "database",
      transport: "sse",
      url: "http://localhost:3001/mcp",
    },
  ],
});

// Ou dinamicamente em runtime
await agent.connectMCP({
  name: "slack",
  transport: "stdio",
  command: "npx",
  args: ["@slack/mcp-server"],
});

// Desconectar
await agent.disconnectMCP();

// Checar saude
agent.getHealth();
// { servers: [{ name: "whatsapp", status: "connected", toolCount: 5, ... }] }
```

O `MCPAdapter` converte cada tool do servidor MCP em um `AgentTool` automaticamente — elas aparecem para o LLM como tools normais. Se o servidor cair, reconecta com backoff automatico.

Requer `@modelcontextprotocol/sdk` instalado. Se nao tiver, da erro amigavel.

---

## Skills — Como adicionar modos de comportamento

Skills sao "modos" que alteram o comportamento do agente (system prompt, tools disponiveis) baseado no input:

```typescript
const reviewSkill: AgentSkill = {
  name: "code-review",
  description: "Reviews code for quality and bugs",
  triggerPrefix: "/review",
  instructions: "Voce e um revisor de codigo. Analise...",
  tools: [lintTool, analyzeTool],
  priority: 10,
  exclusive: true,
};

const translateSkill: AgentSkill = {
  name: "translator",
  description: "Translates text between languages",
  match: (input) => /traduz|translate/i.test(input),
  instructions: "Voce e um tradutor profissional...",
};

const ragSkill: AgentSkill = {
  name: "knowledge-qa",
  description: "Answers questions based on company knowledge base",
  // sem prefix nem match — usa matching semantico via embeddings
  instructions: "Responda baseado apenas na base de conhecimento...",
  priority: 5,
};

agent.addSkill(reviewSkill);
agent.addSkill(translateSkill);
agent.addSkill(ragSkill);
```

### 3 formas de ativar uma skill

| Metodo | Exemplo de input | Quando usar |
|---|---|---|
| `triggerPrefix` | `"/review esse codigo"` | Comandos explicitos |
| `match()` | `"traduz isso para ingles"` | Regex ou logica custom |
| Semantico (embeddings) | `"o que diz a politica de ferias?"` | Ativacao inteligente automatica |

### Desempate quando multiplas skills matcham

1. `exclusive: true` tem prioridade absoluta
2. Maior `priority` vence
3. Especificidade: prefix > custom match > semantico
4. Maximo 3 skills ativas simultaneas

---

## Threads e Memoria — Persistencia em SQLite

Tudo persiste no mesmo arquivo SQLite (`~/.agent/data.db` por padrao). Tres tabelas:

### Conversas (threads)

```sql
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls TEXT,          -- JSON
  tool_call_id TEXT,
  pinned INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

### Memorias

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  scope TEXT NOT NULL,              -- 'thread' | 'persistent' | 'learned'
  category TEXT NOT NULL,           -- 'fact' | 'preference' | 'procedure' | 'insight' | 'context'
  confidence REAL DEFAULT 0.8,
  access_count INTEGER DEFAULT 0,
  source TEXT DEFAULT 'extracted',
  thread_id TEXT,
  embedding BLOB,                  -- Float32Array serializado
  created_at INTEGER,
  last_accessed_at INTEGER
);
CREATE VIRTUAL TABLE memories_fts USING fts5(content);
```

### Knowledge (vetores)

```sql
CREATE TABLE vectors (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  embedding BLOB NOT NULL,
  metadata TEXT,            -- JSON
  created_at INTEGER
);
```

Uso com threads e memoria:

```typescript
const agent = new Agent({
  apiKey: "...",
  model: "...",
  memory: true,
  storage: {
    path: "./meu-projeto/data.db",
    walMode: true,
    inMemory: false,          // true para testes
  },
});

await agent.chat("Sou o Douglas", { threadId: "user-1" });
await agent.chat("Sou a Maria",   { threadId: "user-2" });

await agent.chat("Quem sou eu?", { threadId: "user-1" }); // Douglas
await agent.chat("Quem sou eu?", { threadId: "user-2" }); // Maria
```

---

## Embeddings no SQLite — Como funciona

SQLite **nao tem suporte nativo a vetores** como o pgvector do Postgres. O framework resolve isso armazenando embeddings como **BLOB** (Float32Array serializado) e calculando similaridade cosseno **em JavaScript**:

```typescript
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

### Limites praticos

- **< 100K vetores** — performance aceitavel (~50ms para 50K vetores)
- **> 100K vetores** — necessario plugar PgVector, Qdrant, etc.

### O que sao 100K vetores na pratica

Com chunks de 512 tokens (padrao):

| Conteudo | Chunks aproximados |
|---|---|
| 1 documento de 10 paginas | ~20 chunks |
| 100 documentos | ~2.000 chunks |
| 1.000 documentos | ~20.000 chunks |
| 5.000 documentos | ~100.000 chunks (limite) |

100K chunks equivale a aproximadamente **50.000 paginas de texto** ou **100 livros inteiros**. Para um agente local ou de empresa pequena, e mais que suficiente.

---

## Portabilidade — Trocar SQLite por outro banco

A arquitetura usa interfaces plugaveis. O framework vem com SQLite, mas trocar e implementar a interface correspondente:

### VectorStore (Knowledge/RAG)

```typescript
interface VectorStore {
  upsert(id: string, embedding: number[], metadata: Record<string, unknown>, content: string): Promise<void>;
  search(embedding: number[], topK: number): Promise<VectorSearchResult[]>;
  delete(id: string): Promise<void>;
}
```

### MemoryStore (Memorias)

```typescript
interface MemoryStore {
  save(memory: Memory): Promise<void>;
  search(query: string, limit?: number): Promise<Memory[]>;
  list(scope?: MemoryScope): Promise<Memory[]>;
  delete(id: string): Promise<void>;
  update(id: string, updates: Partial<Memory>): Promise<void>;
}
```

### ConversationStore (Threads)

```typescript
interface ConversationStore {
  save(threadId: string, messages: ChatMessage[]): Promise<void>;
  load(threadId: string): Promise<ChatMessage[]>;
  delete(threadId: string): Promise<void>;
  list(): Promise<string[]>;
}
```

### Exemplo de troca

```typescript
// Default: SQLite (tudo local, zero config)
const agent = new Agent({ knowledge: true });

// PgVector
const agent = new Agent({
  knowledge: { store: new PgVectorStore({ connectionString: "postgres://..." }) },
});

// Qdrant
const agent = new Agent({
  knowledge: { store: new QdrantStore({ url: "http://localhost:6333", collection: "docs" }) },
});
```

### Resumo de portabilidade

| Componente | Interface | Trocar por | Esforco |
|---|---|---|---|
| Knowledge/RAG | `VectorStore` | PgVector, Qdrant, Pinecone, Weaviate | 3 metodos |
| Memorias | `MemoryStore` | Postgres, Redis, Mongo | 5 metodos |
| Conversas | `ConversationStore` | Postgres, Redis | 4 metodos |

A portabilidade esta na arquitetura (interfaces), nao no codigo pronto — cada store alternativo precisa ser implementado por quem for usar.

---

## Pipeline de Contexto — Como tudo se integra

Quando o usuario envia uma mensagem, o `ContextPipeline` roda em ordem:

```
Input do usuario
  -> SkillsStage (detecta e injeta instrucoes de skills ativas)
  -> KnowledgeStage (busca RAG nos documentos ingeridos)
  -> MemoryStage (busca memorias relevantes)
  -> HistoryStage (aplica windowing/compactacao)
  -> LLM recebe tudo montado
```

Cada subsistema compete pelo budget de tokens — quando aperta, o pipeline corta por prioridade (memoria antiga primeiro, skills por ultimo).
