---
name: codegen-contracts
description: Setup inicial: gera tipos compartilhados, schema e scaffold do projeto (roda 1x).
---

# Codegen — Contratos Compartilhados (Setup Inicial)

Voce vai gerar o "shared kernel" do projeto — os tipos, schema e scaffold que todas as features futuras importarao. Este skill roda UMA VEZ no inicio e cria a fundacao tipada do projeto.

**Por que este skill e critico:** Tudo que vem depois IMPORTA destes contratos. Se os tipos estiverem corretos, cada sessao subsequente pode gerar codigo tipado sem precisar reler o domain model inteiro.

## Pre-requisitos

- Blueprint tecnico preenchido (pelo menos 04-domain-model, 05-data-model, 06-system-architecture)
- Backend docs gerados (`docs/backend/`)
- CLAUDE.md gerado no projeto-alvo (via `/codegen-claudemd`)

## Passo 1: Receber o Projeto-Alvo

Verifique se o usuario passou um argumento (caminho do projeto-alvo). Se sim, use-o. Se nao, pergunte:

> "Qual o caminho do projeto-alvo onde o scaffold sera gerado? (ex: `../meu-saas/`)"

Aguarde a resposta.

## Passo 2: Leitura de Contexto

Leia os seguintes documentos **completos**:

### Do Blueprint Tecnico:
1. `docs/blueprint/04-domain-model.md` — entidades, glossario, regras de negocio
2. `docs/blueprint/05-data-model.md` — tabelas, campos, tipos, constraints, indices
3. `docs/blueprint/06-system-architecture.md` — stack, componentes, protocolos
4. `docs/blueprint/02-architecture_principles.md` — principios guia

### Do Backend (spec de implementacao):
5. `docs/backend/00-backend-vision.md` — stack e padroes do backend
6. `docs/backend/01-architecture.md` — camadas arquiteturais
7. `docs/backend/02-project-structure.md` — estrutura de diretorios do backend
8. `docs/backend/03-domain.md` — entidades, value objects, domain events
9. `docs/backend/04-data-layer.md` — repositories, ORM, migrations

### Do Frontend:
10. Identifique quais clientes existem em `docs/frontend/` (web, mobile, desktop)
11. Leia `docs/frontend/shared/03-design-system.md` — design tokens compartilhados
12. Para cada cliente existente, leia `docs/frontend/{{client}}/02-project-structure.md`

### Dos Docs Compartilhados:
13. `docs/shared/glossary.md` — linguagem ubiqua e convencoes de nomenclatura

> **Versoes:** Para tecnologias com versao, consulte via `mcp__context7__resolve-library-id` → `mcp__context7__query-docs`.

Se algum doc tiver mais de 50k tokens, use Context Excerpting:
- Grep pelos headers para ver a estrutura
- Carregue apenas as secoes de entidades, tabelas e stack

## Passo 3: Analisar e Planejar

A partir dos docs, extraia:

### Do Domain Model (blueprint/04) + Backend Domain (backend/03):
- Lista de entidades com seus atributos e tipos
- Enums e valores possiveis
- Regras de negocio por entidade
- Relacionamentos entre entidades
- Value objects e domain events

### Do Data Model (blueprint/05) + Backend Data Layer (backend/04):
- Tecnologia de banco (PostgreSQL, MySQL, MongoDB, etc.)
- Tabelas com campos, tipos e constraints
- Indices e queries criticas
- Estrategia de migration
- Patterns de repository

### Da System Architecture (blueprint/06) + Backend Architecture (backend/01):
- Stack tecnologica completa (linguagem, framework, ORM, etc.)
- Componentes do sistema
- Protocolos de comunicacao
- Camadas e regras de dependencia

### Dos Principios (blueprint/02):
- Patterns arquiteturais (Clean Architecture, DDD, Hexagonal, etc.)
- Convencoes de organizacao de codigo

### Da Estrutura Frontend:
- Clientes ativos (web, mobile, desktop)
- Estrutura de pastas por cliente
- Framework e bibliotecas por cliente

Apresente ao usuario um resumo:

> "Vou gerar o scaffold com base nos blueprints:
>
> **Stack:** {{stack resumida}}
> **Entidades:** {{lista de entidades}}
> **Banco:** {{tecnologia}} com {{N}} tabelas
> **Principios:** {{patterns principais}}
> **Clientes frontend:** {{web, mobile, desktop — apenas os existentes}}
>
> Confirma? Ou quer ajustar algo antes de gerar?"

Aguarde confirmacao.

## Passo 4: Gerar Scaffold

Crie a estrutura de diretorios conforme a arquitetura definida nos blueprints e docs de backend/frontend. A estrutura DEVE seguir o que esta documentado em `backend/02-project-structure.md` e `frontend/{{client}}/02-project-structure.md`.

Gere na seguinte ordem:

### 4.1: Configuracao do Projeto
- `package.json` (ou equivalente) com dependencias da stack definida
- `tsconfig.json` (ou equivalente)
- `.env.example` com variaveis necessarias
- `.gitignore`
- Configuracao de linting/formatting conforme blueprint

### 4.2: Tipos Compartilhados (`src/contracts/`)

Para CADA entidade do domain model, gere um arquivo de tipo:

```
src/contracts/
├── entities/          # Um arquivo por entidade
│   ├── {{entity}}.ts  # Interface/type da entidade
│   └── index.ts       # Barrel export
├── enums/             # Enums extraidos do domain model
│   ├── {{enum}}.ts    # Cada enum
│   └── index.ts       # Barrel export
├── api/               # Request/Response types
│   ├── {{resource}}.ts
│   └── index.ts
└── index.ts           # Barrel export raiz
```

**Regras para geracao de tipos:**
- Nomes de entidades: PascalCase (conforme glossario)
- Campos: camelCase
- Enums: PascalCase para o tipo, SCREAMING_SNAKE_CASE para valores
- Cada tipo deve ter JSDoc com a descricao do domain model
- Tipos de ID devem ser branded types quando possivel
- Relacionamentos devem usar os tipos das entidades referenciadas

### 4.3: Schema do Banco

Gere o schema completo baseado em `docs/blueprint/05-data-model.md` e `docs/backend/04-data-layer.md`:
- Se a stack usa Prisma: `prisma/schema.prisma`
- Se usa Drizzle: `src/db/schema.ts`
- Se usa TypeORM: entities com decorators
- Se usa outro ORM: conforme a stack

O schema DEVE incluir:
- Todas as tabelas do data model
- Todos os campos com tipos corretos
- Constraints (unique, not null, default)
- Relacionamentos (foreign keys)
- Indices definidos no data model
- Enums do banco

### 4.4: Scaffold de Diretorios

Crie a estrutura de pastas conforme `backend/02-project-structure.md` com arquivos `index.ts` (ou equivalente) vazios para:
- Camada de servicos/use cases
- Camada de repositorios/data access
- Camada de rotas/controllers
- Camada de middlewares

Para cada cliente frontend existente, crie a estrutura conforme `frontend/{{client}}/02-project-structure.md`.

### 4.5: Configuracao de Testes

- Setup de test runner conforme `docs/backend/14-tests.md` e `docs/blueprint/12-testing_strategy.md`
- Arquivo de configuracao (jest.config, vitest.config, etc.)
- Helper/factory para criacao de fixtures baseadas nas entidades

## Passo 5: Validacao

Apos gerar, execute:

1. **Type check**: Rode o type checker para garantir que os tipos estao corretos
2. **Lint**: Rode o linter para garantir formatacao
3. **Schema validation**: Rode validacao do schema (ex: `prisma validate`)

Se houver erros, corrija antes de prosseguir.

## Passo 6: Apresentar Resultado

> "Setup inicial concluido. Scaffold gerado:
>
> - **{{N}} tipos** de entidades em `src/contracts/entities/`
> - **{{N}} enums** em `src/contracts/enums/`
> - **{{N}} tipos de API** em `src/contracts/api/`
> - **Schema** com {{N}} tabelas em `{{caminho do schema}}`
> - **Backend** com {{N}} diretorios conforme `backend/02-project-structure.md`
> - **Frontend** ({{clientes}}) com {{N}} diretorios cada
>
> Os contratos sao a fonte de verdade tipada. Todas as features futuras devem importar de `src/contracts/`.
>
> Rode `/codegen` para ver as entregas do build plan, ou `/codegen-feature [nome]` para implementar a primeira feature."

## Passo 7: Commit

Sugira ao usuario:

> "Deseja fazer o commit inicial? Sugestao: `feat: project scaffold and shared contracts (setup inicial)`"
