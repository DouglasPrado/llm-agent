# AgentX SDK

## Fonte de Verdade

Todo codigo DEVE implementar fielmente o que esta documentado nos blueprints.

**Docs:** `docs/blueprint/` (O QUE) → `docs/backend/` (COMO backend) → `docs/shared/` (glossario, mappings)

**Regras:**

1. Leia docs relevantes antes de codar
2. Use linguagem ubiqua de `docs/shared/glossary.md`
3. Leia `src/contracts/` antes de implementar
4. Test-first (RED → GREEN → REFACTOR)
5. Use `docs/shared/MAPPING.md` para rastreabilidade

---

## Stack Tecnologica

| Camada             | Tecnologia                        | Versao  | Justificativa                                     |
| ------------------ | --------------------------------- | ------- | ------------------------------------------------- |
| Linguagem          | TypeScript                        | 5.x     | Tipagem estatica, API publica clara               |
| Runtime            | Node.js                           | 22+     | `fetch()` nativo, `AbortSignal`, dynamic import   |
| Framework          | Nenhum                            | N/A     | Biblioteca standalone in-process                  |
| Validacao          | Zod                               | 3.x     | Unico sistema de validacao permitido              |
| Persistencia       | `better-sqlite3` + SQLite         | 3.x     | Arquivo unico, WAL mode, FTS5, zero config        |
| Contratos de tools | `zod-to-json-schema`              | 3.x     | Conversao Zod → JSON Schema para function calling |
| Cache              | LRU em memoria                    | Interno | TTL configuravel, zero deps extras                |
| Streaming          | `AsyncIterableIterator` + eventos | Interno | Streaming first, sem broker externo               |

**Limite:** <= 4 dependencias diretas em `dependencies`.

---

## Clientes Frontend

Nenhum cliente frontend documentado. O AgentX SDK e uma biblioteca TypeScript backend-only.

---

## Mapa de Contexto por Tarefa

Antes de iniciar qualquer tarefa, leia os docs listados conforme o tipo de trabalho.

### Tipos + Utils + Config

- docs/blueprint/04-domain_model.md (entidades, regras)
- docs/blueprint/05-data_model.md (tabelas, schema SQL)
- docs/backend/03-domain.md (implementacao de entidades)

### LLM / OpenRouter

- docs/blueprint/06-system_architecture.md (secao LLM Layer)
- docs/blueprint/07-critical_flows.md (Fluxo 1: Stream Chat)
- docs/backend/00-backend-vision.md (stack, provedores)

### Storage / SQLite

- docs/blueprint/05-data_model.md (tabelas, migrations, indices)
- docs/backend/04-data-layer.md (repositories, schema SQL)

### Tools / MCP

- docs/blueprint/06-system_architecture.md (secao Tools Subsystem)
- docs/blueprint/07-critical_flows.md (Fluxo 4: MCP Connection)
- docs/blueprint/08-use_cases.md (UC-003, UC-004)

### Memory

- docs/blueprint/06-system_architecture.md (secao Memory Subsystem)
- docs/blueprint/07-critical_flows.md (Fluxo 2: Memory Extraction)
- docs/blueprint/09-state_models.md (Memory lifecycle)

### Knowledge / RAG

- docs/blueprint/06-system_architecture.md (secao Knowledge Subsystem)
- docs/blueprint/07-critical_flows.md (Fluxo 3: Knowledge Ingestion)
- docs/blueprint/08-use_cases.md (UC-005)

### Skills

- docs/blueprint/06-system_architecture.md (secao Skills Subsystem)
- docs/blueprint/08-use_cases.md (UC-007)

### Core (Loop + Contexto + Stream)

- docs/blueprint/07-critical_flows.md (Fluxo 5: Context Pipeline)
- docs/blueprint/09-state_models.md (ReactLoop states)
- docs/backend/01-architecture.md (camadas, comunicacao)

### Security

- docs/blueprint/13-security.md (threat model, dados sensiveis)

### Testing

- docs/blueprint/12-testing_strategy.md (piramide, cobertura, CI)

### Observabilidade

- docs/blueprint/15-observability.md (logs, metricas, tracing, alertas)

---

## Convencoes de Codigo

### Nomenclatura

| Contexto          | Convencao                      | Exemplo                                |
| ----------------- | ------------------------------ | -------------------------------------- |
| Entidades/Classes | PascalCase, singular, ingles   | Agent, Memory, ToolExecutor            |
| Interfaces        | PascalCase, prefixo descritivo | MemoryStore, VectorStore, AgentTool    |
| Campos/Atributos  | camelCase, ingles              | threadId, accessCount, lastAccessedAt  |
| Colunas SQLite    | snake_case, ingles             | thread_id, access_count                |
| Tipos de evento   | snake_case, ingles             | text_delta, tool_call_start, agent_end |
| Arquivos          | kebab-case, ingles             | react-loop.ts, memory-manager.ts       |
| Constantes        | UPPER_SNAKE_CASE               | MAX_ITERATIONS, DEFAULT_TIMEOUT        |
| Enums/Scopes      | lowercase, ingles              | thread, persistent, learned            |

### Principios Arquiteturais

1. **Dependencias minimas** — HTTP via `fetch()` nativo; proibido axios, SDKs de LLM; validacao so Zod
2. **Interfaces plugaveis** — `MemoryStore`, `VectorStore`, `ConversationStore` sao interfaces; SQLite e default
3. **Streaming first** — `stream()` e a API primaria; `chat()` consome `stream()` internamente
4. **Falhe explicitamente, recupere graciosamente** — Retry com backoff, `onToolError: 'continue'`, erros com `traceId`
5. **Isolamento por design** — Mutex por thread, timeout por tool, `traceId` por execucao
6. **Custo como constraint** — `CostPolicy` com limites por execucao e sessao; `maxToolCallsPerExecution`
7. **Observabilidade embutida** — Eventos com `traceId`, `duration`; hooks para OpenTelemetry

### Camadas do Backend (Regras de Dependencia)

```
Public API  →  Core/Application  →  Domain  ←  Infrastructure
```

- **Domain** nunca importa de Infrastructure ou Public API
- **Agent** e managers nao acessam SQL bruto fora dos stores
- Implementacoes concretas ficam atras de interfaces/ports
- `chat()` sempre consome `stream()` internamente
- Eventos sao o contrato de observabilidade — nenhum subsistema falha silenciosamente

### Glossario do Dominio (Termos-Chave)

| Termo      | Significado                               | Uso no Codigo                           |
| ---------- | ----------------------------------------- | --------------------------------------- |
| Agent      | Orquestrador de conversacao com LLM       | Classe `Agent`, ponto de entrada        |
| ReactLoop  | Ciclo LLM → tool_calls → execute → repete | Classe `ReactLoop`                      |
| AgentEvent | Unidade atomica de streaming              | Tipo union, emitido por `StreamEmitter` |
| Memory     | Fato extraido de conversas com decay      | Interface `Memory`, `MemoryStore`       |
| Knowledge  | Documento ingerido para RAG               | `KnowledgeDocument`, `VectorStore`      |
| Thread     | Contexto isolado de conversa              | `threadId` no `ConversationManager`     |
| CostPolicy | Limites de tokens/custo por execucao      | Config em `AgentConfig`                 |
| MCP        | Model Context Protocol (tools externas)   | `MCPAdapter`, stdio/SSE                 |

---

## Sempre Ler Antes de Codar

- `src/contracts/` — tipos compartilhados e interfaces
- `docs/shared/glossary.md` — linguagem ubiqua
- `package.json` — dependencias instaladas

---

## Workflow de Desenvolvimento (XP)

```
1. Leia os docs do blueprint relevantes para a feature
2. Leia src/contracts/ para tipos existentes
3. RED:      Escreva os testes primeiro
4. GREEN:    Implemente o minimo para os testes passarem
5. REFACTOR: Melhore o codigo mantendo testes verdes
6. Commit small release
```

---

## Skills de Codegen Disponiveis

| Skill                | Uso                              | Quando                  |
| -------------------- | -------------------------------- | ----------------------- |
| `/codegen`           | Apresenta entregas do build plan | Inicio de sessao        |
| `/codegen-contracts` | Gera tipos, schema, scaffold     | Setup inicial (uma vez) |
| `/codegen-feature`   | Implementa feature (TDD)         | Dia-a-dia               |
| `/codegen-verify`    | Verifica codigo vs blueprint     | A cada 3-5 features     |
| `/codegen-claudemd`  | Gera/atualiza este arquivo       | Setup inicial           |

---

## Context Excerpting

Para docs grandes (50k+ tokens), NAO carregue o doc inteiro:

1. Leia o indice/sumario do doc (headers)
2. Use Grep para encontrar secoes relevantes a feature
3. Carregue apenas as secoes necessarias

---

## Publicacao no npm

- Pacote: `agentx-sdk`
- Usar versionamento semantico (semver): `MAJOR.MINOR.PATCH`
- Antes de publicar: rodar testes, build e verificar que `package.json` esta com versao correta
- Comando: `npm publish --access public`
- Bump de versao: `npm version patch|minor|major` conforme o tipo de mudanca
