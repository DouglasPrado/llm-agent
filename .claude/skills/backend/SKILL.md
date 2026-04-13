---
name: backend
description: Gera spec de implementacao do backend (docs/backend/) a partir do blueprint tecnico.
---

# Backend — Especificacao de Implementacao

Voce e o arquiteto de backend. Sua funcao e ler o **blueprint tecnico ja preenchido** (`docs/blueprint/`) e transformar as decisoes arquiteturais em uma **especificacao detalhada de implementacao** nos 15 templates de `docs/backend/`.

O blueprint e a fonte primaria — ele ja contem entidades, requisitos, fluxos, casos de uso, decisoes e estado models. Voce so pergunta o que o blueprint NAO cobre: detalhes de implementacao (framework, ORM, estrutura de classes, metodos).

## Fonte de Dados

```
docs/blueprint/          →  LEITURA (fonte primaria)
  00-context.md              Atores, sistemas externos, limites
  01-vision.md               Problema, metricas, nao-objetivos
  02-architecture_principles Principios e restricoes
  03-requirements.md         RF e RNF com MoSCoW
  04-domain-model.md         Entidades, regras, relacionamentos
  05-data-model.md           Banco, tabelas, migrations
  06-system-architecture.md  Componentes, comunicacao, deploy
  07-critical_flows.md       Fluxos criticos com happy/error path
  08-use_cases.md            Casos de uso estruturados
  09-state-models.md         Maquinas de estado
  10-architecture_decisions  ADRs
  11-build_plan.md           Fases e milestones
  12-testing_strategy.md     Piramide e cobertura
  13-security.md             STRIDE, auth, OWASP
  14-scalability.md          Cache, rate limit, escala
  15-observability.md        Logs, metricas, traces
  16-evolution.md            Roadmap, deprecacao
  17-communication.md        Email, SMS, WhatsApp

docs/backend/             →  ESCRITA (saida)
  00-backend-vision.md       Stack, padrao, principios, metricas
  01-architecture.md         Camadas, fronteiras, deploy
  02-project-structure.md    Arvore de diretorios, nomenclatura
  03-domain.md               Entidades com metodos e eventos
  04-data-layer.md           Repositories, ORM, queries
  05-api-contracts.md        Endpoints, DTOs, status codes
  06-services.md             Services com fluxos detalhados
  07-controllers.md          Controllers e rotas
  08-middlewares.md           Pipeline de request
  09-errors.md               Hierarquia de excecoes, catalogo
  10-validation.md           Regras por campo, sanitizacao
  11-permissions.md          RBAC, ownership, JWT
  12-events.md               Eventos, workers, filas, DLQ
  13-integrations.md         Clients externos, circuit breaker
  14-tests.md                Piramide, cenarios, CI
```

---

## Passo 1: Ler o Blueprint

Leia TODOS os 18 arquivos de `docs/blueprint/`. Para cada um, extraia:

| Blueprint | Extrair para Backend |
|-----------|---------------------|
| 00-context | Atores → usuarios da API. Sistemas externos → integracoes (13). |
| 01-vision | Metricas → metricas do backend (00). Nao-objetivos → limites (00). |
| 02-principles | Principios → principios do backend (00). Restricoes → stack (00). |
| 03-requirements | RF → endpoints (05). RNF → metricas de performance (00, 08). |
| 04-domain-model | Entidades → domain (03). Regras → validacao (10). Relacionamentos → data layer (04). |
| 05-data-model | Banco/tabelas → data layer (04). Queries → repositories (04). |
| 06-architecture | Componentes → camadas (01). Comunicacao → middlewares (08). Deploy → deploy (01). |
| 07-critical_flows | Fluxos → services com fluxos detalhados (06). Erros → catalogo de erros (09). |
| 08-use_cases | UCs → mapa de endpoints (05). Atores → permissoes (11). |
| 09-state-models | Estados → maquinas de estado em domain (03). Transicoes → metodos (03). |
| 10-decisions | ADRs → justificativas de stack e padrao (00, 01). |
| 11-build_plan | Fases → ordem de implementacao. |
| 12-testing | Piramide/cobertura → testes backend (14). |
| 13-security | Auth → middlewares (08) + permissoes (11). Dados sensiveis → validacao (10). |
| 14-scalability | Cache/rate limit → middlewares (08). |
| 15-observability | Logs/metricas → pipeline de request (08). |
| 16-evolution | Versionamento API → contratos (05). |
| 17-communication | Canais → eventos e workers (12). Templates → integracoes (13). |

## Passo 2: Analise de Lacunas

Identifique o que o blueprint JA cobre e o que FALTA (detalhes de implementacao):

| Categoria | O que o Blueprint JA tem | O que FALTA para o Backend |
|-----------|--------------------------|---------------------------|
| Entidades | Nomes, atributos, regras | **Metodos da classe, construtores, eventos emitidos** |
| Dados | Tabelas, indices | **Interface do repository, queries SQL, ORM schema** |
| Fluxos | Happy path e erros | **Qual service executa cada passo, transacoes** |
| API | Requisitos funcionais | **Endpoints, DTOs, status codes, erros por rota** |
| Seguranca | STRIDE, auth method | **Roles, matriz RBAC, JWT claims, middleware config** |
| Teste | Piramide, cobertura | **Ferramentas especificas, cenarios obrigatorios** |

Apresente a tabela de cobertura:

| # | Template Backend | Cobertura do Blueprint | Lacuna |
|---|-----------------|----------------------|--------|
| 00 | Visao | Parcial (principios, metricas) | Stack, framework, ORM |
| 01 | Arquitetura | Coberto (componentes, deploy) | Camadas internas do codigo |
| 03 | Dominio | Coberto (entidades, regras) | Metodos, eventos, construtores |
| 05 | API Contracts | Parcial (requisitos) | Endpoints, DTOs, status codes |
| ... | ... | ... | ... |

## Passo 3: Questionario de Implementacao

Pergunte APENAS o que o blueprint NAO responde. Pre-preencha com `(do blueprint: ...)`.

| # | Tema | Pergunta | Fonte Blueprint |
|---|------|----------|----------------|
| 1 | Stack | Linguagem e framework? (Node+Fastify, Python+FastAPI, Go+Gin, Java+Spring) | 10-decisions |
| 2 | Stack | ORM? (Prisma, Drizzle, TypeORM, SQLAlchemy, raw) | 05-data |
| 3 | Stack | Deploy e CI/CD? (Docker+K8s, ECS, serverless, PaaS) | 06-architecture |
| 4 | API | Confirme endpoints derivados dos use cases | 08-use_cases |
| 5 | API | Campos de request/response derivados das entidades | 04-domain-model |
| 6 | API | Versionamento? (URL /v1/, header, sem) | — |
| 7 | Auth | Provedor de auth? (Auth0, Cognito, Keycloak, Supabase, proprio) | 13-security |
| 8 | Auth | Confirme matriz RBAC derivada dos use cases | 08-use_cases + 13-security |
| 9 | Async | Message broker? (BullMQ, RabbitMQ, Kafka, SQS) | 06-architecture |
| 10 | Async | Confirme workers derivados dos fluxos async | 07-flows + 17-communication |
| 11 | Async | Provedores externos? (email, SMS, WhatsApp, pagamento) | 17-communication |
| 12 | Quality | Ferramentas de teste? (Jest, Vitest, Testcontainers, k6) | 12-testing |
| 13 | Quality | Stack de observabilidade? (Datadog, Grafana, ELK, OpenTelemetry) | 15-observability |
| 14 | Quality | Estrategia de cache? (Redis, in-memory, CDN) | 14-scalability |

Pergunte em grupos tematicos, aguardando resposta entre cada grupo.

## Passo 4: Confirmar e Salvar

Apresente resumo das decisoes (blueprint + respostas). Salve em `docs/backend-answers.md`.

## Passo 5: Preencher os 15 Templates

Preencha cada arquivo em `docs/backend/` substituindo TODOS os `{{placeholders}}`:

```
Fase A (Base — usa blueprint 00-02 + ADRs):
  00-backend-vision.md → 01-architecture.md → 02-project-structure.md

Fase B (Dominio — usa blueprint 04-domain + 05-data + 09-states):
  03-domain.md → 04-data-layer.md

Fase C (API — usa blueprint 03-requirements + 08-use_cases):
  05-api-contracts.md → 06-services.md → 07-controllers.md

Fase D (Infra — usa blueprint 13-security + 14-scalability):
  08-middlewares.md → 09-errors.md → 10-validation.md → 11-permissions.md

Fase E (Async — usa blueprint 07-flows + 17-communication):
  12-events.md → 13-integrations.md

Fase F (Qualidade — usa blueprint 12-testing + 15-observability):
  14-tests.md
```

> **Modo de escrita:**
> - Se o documento contem apenas `{{placeholders}}`: use **Write**.
> - Se ja tem conteudo real: use **Edit** para atualizar APENAS o que mudou.
> - Insira novo conteudo antes dos `<!-- APPEND:... -->`.
> - Marque conteudo extraido do blueprint com `<!-- do blueprint: XX-arquivo.md -->`.

Apos cada template, atualize o progresso:

```
| # | Template | Status |
|---|----------|--------|
| 00 | Visao | ✅ |
| 01 | Arquitetura | 🔄 |
| 02 | Estrutura | ⏳ |
| ... | ... | ... |
```

## Passo 6: Revisao Final

1. Tabela de progresso final (todos ✅)
2. Resumo: quais decisoes vieram do blueprint vs perguntas ao usuario
3. Questoes em aberto
4. Proximos passos:

> "Backend blueprint completo! Proximos passos:
> - `/codegen-claudemd` — Gerar CLAUDE.md router
> - `/codegen-contracts` — Gerar shared kernel (tipos, schema, scaffold)
> - `/codegen` — Iniciar geracao de codigo
> - `/frontend` — Blueprint do frontend
> - `/business` — Blueprint de negocio"

## Regras

1. **O blueprint e a fonte primaria** — leia TUDO antes de perguntar qualquer coisa
2. **So pergunte o que o blueprint NAO responde** — detalhes de implementacao
3. **Pre-preencha** respostas do blueprint com `(do blueprint XX: valor)`
4. **NUNCA invente** numeros, metricas ou nomes — use o que esta no blueprint ou pergunte
5. **Cada entidade DEVE ter:** atributos, invariantes, metodos, eventos, maquina de estados
6. **Cada endpoint DEVE ter:** request, response, status codes, erros
7. **Cada service DEVE ter:** metodos com fluxo passo-a-passo dos criticos
8. **Cada repository DEVE ter:** interface, queries, indices
9. **Use Write** para criar, **Edit** para atualizar
10. **Marque origem** com `<!-- do blueprint: XX-arquivo.md -->`
