---
name: codegen-feature
description: Implementa uma feature vertical (DB + API + Frontend + Testes) com TDD/XP.
---

# Codegen — Feature Vertical (XP Pair Programming)

Implementa UMA feature como vertical slice: banco, API, frontend e testes. Ciclo XP: **RED → GREEN → REFACTOR**.

## Pre-requisitos

- `/codegen-contracts` executado (tipos e schema existem)
- CLAUDE.md presente (via `/codegen-claudemd`)

## Passo 1: Receber a Feature

Se o usuario passou argumento, use-o. Senao, pergunte:

> "Qual feature? Ex: `autenticacao`, `crud-produtos`, `checkout`, `dashboard`"

## Passo 2: Carregar Contexto (apenas o necessario)

**NAO carregue todos os blueprints.** Leia CLAUDE.md e `docs/shared/MAPPING.md` para identificar docs relevantes.

**Carga condicional por tipo de feature:**

| Tipo | Blueprint (max 3) | Backend (max 3) | Frontend (max 2) |
|------|-------------------|-----------------|------------------|
| CRUD | 04-domain, 05-data, 08-use_cases | 03-domain, 05-api-contracts, 06-services | {{client}}/04-components |
| Fluxo | 07-flows, 08-use_cases, 09-states | 06-services, 09-errors | {{client}}/08-flows, {{client}}/05-state |
| Auth | 07-flows, 13-security | 08-middlewares, 11-permissions | {{client}}/11-security |
| Dashboard | 07-flows | 05-api-contracts, 06-services | {{client}}/04-components |
| Integracao | 06-architecture | 13-integrations, 12-events | {{client}}/08-flows |

**Docs shared** (so quando relevante): `glossary.md`, `event-mapping.md`, `error-ux-mapping.md`

**Context excerpting:** Para cada doc, leia headers primeiro (grep `#`), depois carregue apenas secoes relevantes (Read com offset/limit).

**Contratos:** Leia `src/contracts/` — entidades e tipos relevantes para a feature.

**Clientes frontend:** Verifique `docs/frontend/` (web/mobile/desktop). Se multi-client, pergunte qual. Se um so, use automaticamente. Backend-only → pule frontend.

## Passo 3: Apresentar Plano

> "Feature: **{{nome}}**
>
> 1. **Banco**: {{migrations}}
> 2. **Backend**: {{endpoints, services}}
> 3. **Frontend ({{clientes}})**: {{componentes, hooks}}
> 4. **Testes**: {{unit, integration}}
>
> Confirma?"

## Passo 4: RED — Testes Primeiro

Escreva testes ANTES da implementacao:

- **Backend:** unitarios (regras de negocio), integracao (endpoints), estado (se houver state machine)
- **Frontend:** componente (render, interacao), hook/estado, integracao (fluxo)
- Nomes descritivos baseados no use case. Use tipos de `src/contracts/`

Execute — todos devem **FALHAR**.

> "**RED**: {{N}} testes escritos, todos falhando."

## Passo 5: GREEN — Implementar o Minimo

Implemente o minimo para os testes passarem:

1. **Schema/Migrations** (se necessario)
2. **Backend:** repository → service → controller → validacao → erros → middlewares/permissoes (conforme docs/backend/)
3. **Frontend:** componentes → hooks → data layer → rotas → copies (conforme docs/frontend/)

**Regras:** Use tipos de `src/contracts/` (nao crie duplicados). Novos tipos → adicione em `src/contracts/` primeiro. Use error-ux-mapping para erros.

Execute — todos devem **PASSAR**.

> "**GREEN**: {{N}} testes passando."

## Passo 6: REFACTOR

Refatore mantendo testes verdes: extraia duplicacoes, melhore nomes (linguagem ubiqua), simplifique logica. Execute testes apos cada refatoracao.

## Passo 7: Resultado e Commit

> "Feature **{{nome}}** implementada:
>
> | Camada | Arquivos | Testes |
> |--------|---------|--------|
> | Schema | {{lista}} | — |
> | Backend | {{lista}} | {{N}} |
> | Frontend | {{lista}} | {{N}} |
>
> Commit sugerido: `feat: {{nome}} — {{descricao}}`"

> "Para proxima feature: `/codegen-feature [nome]`. Para verificar: `/codegen-verify`."
