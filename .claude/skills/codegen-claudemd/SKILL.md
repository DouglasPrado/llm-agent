---
name: codegen-claudemd
description: Gera CLAUDE.md router no projeto-alvo a partir dos blueprints preenchidos.
---

# Codegen — Gerar CLAUDE.md Router

Voce vai analisar os blueprints preenchidos e gerar um arquivo `CLAUDE.md` no projeto-alvo. Este arquivo funciona como um **router de contexto** — diz ao Claude Code exatamente quais documentos do blueprint ler para cada tipo de tarefa de codificacao.

## Passo 1: Receber o Projeto-Alvo

Verifique se o usuario passou um argumento (caminho do projeto-alvo). Se sim, use-o. Se nao, pergunte:

> "Para gerar o CLAUDE.md, preciso saber:
> 1. **Caminho do projeto-alvo**: onde o codigo sera gerado (ex: `../meu-saas/`)
> 2. **Caminho dos blueprints**: onde estao os docs preenchidos (default: `docs/`)
>
> Informe o caminho do projeto-alvo."

Aguarde a resposta do usuario.

## Passo 2: Leitura dos Indices dos Blueprints

**NAO leia o conteudo completo dos docs.** Leia apenas os headers (titulos e subtitulos) de cada documento para entender a estrutura. Use Bash com `grep` para extrair apenas as linhas que comecam com `#`:

Para cada doc em `docs/blueprint/`, `docs/backend/`, `docs/frontend/`, `docs/business/`, `docs/shared/`:
1. Extraia os headers (`# `, `## `, `### `)
2. Identifique quais secoes contem conteudo real (nao apenas `{{placeholders}}`)
3. Monte um mapa: `doc → secoes preenchidas`

## Passo 3: Identificar Clientes Frontend

Verifique quais clientes existem em `docs/frontend/`:

```
docs/frontend/shared/    → Docs compartilhados (design system, data layer, API deps)
docs/frontend/web/       → Cliente web
docs/frontend/mobile/    → Cliente mobile
docs/frontend/desktop/   → Cliente desktop
```

Liste apenas os que possuem docs preenchidos.

## Passo 4: Analisar Stack e Convencoes

Leia estes docs **completos** (sao essenciais para o CLAUDE.md):

1. `docs/blueprint/02-architecture_principles.md` — principios que guiam decisoes de codigo
2. `docs/blueprint/06-system-architecture.md` — stack tecnologica, componentes, protocolos
3. `docs/backend/00-backend-vision.md` — stack e padroes do backend
4. `docs/backend/01-architecture.md` — camadas arquiteturais do backend
5. `docs/blueprint/04-domain-model.md` — **somente a secao Glossario/Linguagem Ubiqua** (grep por "Glossario" ou "Linguagem")
6. `docs/shared/glossary.md` — linguagem ubiqua e convencoes de nomenclatura
7. `docs/shared/MAPPING.md` — rastreabilidade entre docs

Extraia:
- **Stack**: linguagens, frameworks, ORMs, bancos, filas
- **Convencoes de nomenclatura**: PascalCase para entidades, camelCase para campos, etc.
- **Principios arquiteturais**: patterns (Clean Architecture, DDD, etc.)
- **Glossario**: termos do dominio que devem ser usados no codigo
- **Camadas do backend**: e suas regras de dependencia

## Passo 5: Gerar o CLAUDE.md

Use o template em `docs/templates/claudemd-template.md` como base (se existir). Caso contrario, gere seguindo esta estrutura:

```markdown
# {{Nome do Projeto}}

## Fonte de Verdade

Todo codigo DEVE implementar fielmente o que esta documentado nos blueprints.

**Docs:** `docs/blueprint/` (O QUE) → `docs/backend/` (COMO backend) → `docs/frontend/` (COMO frontend, com `shared/` + per-client) → `docs/shared/` (glossario, mappings) → `docs/business/` (modelo de negocio)

**Regras:** (1) Leia docs relevantes antes de codar. (2) Use linguagem ubiqua de `docs/shared/glossary.md`. (3) Leia `src/contracts/` antes de implementar. (4) Test-first (RED→GREEN→REFACTOR). (5) Use `docs/shared/MAPPING.md` para rastreabilidade.

## Stack

{{Tabela compacta extraida de backend/00-backend-vision.md e blueprint/06-system-architecture.md}}

## Clientes Frontend

{{Lista de clientes ativos com stack de cada um}}

## Convencoes

- **Nomenclatura:** Entidades PascalCase, campos camelCase. Conforme `docs/shared/glossary.md`
- **Rotas API:** {{padrao extraido da arquitetura}}
- **Arquivos:** {{padrao extraido da estrutura}}
- **Principios:** {{1 linha por principio, extraido de 02-architecture_principles.md}}
- **Camadas backend:** {{regras de dependencia, extraido de backend/01-architecture.md}}

## Antes de Codar

Leia apenas o necessario para a tarefa. Use `/codegen-feature` que guia a selecao de docs por tipo de feature.

Sempre leia: `src/contracts/` (tipos) + `{{arquivo de schema}}` (DB, se relevante)
```

## Passo 6: Salvar e Apresentar

1. Salve o arquivo em `{{projeto-alvo}}/CLAUDE.md`
2. Apresente ao usuario um resumo do que foi gerado:

> "CLAUDE.md gerado em `{{caminho}}`. Contem: hierarquia de docs, stack, clientes frontend, convencoes e principios. Revise e ajuste."

## Passo 7: Proximo Passo

> "CLAUDE.md pronto. Rode `/codegen` para ver as entregas do build plan, ou `/codegen-contracts` para gerar o scaffold e tipos compartilhados (setup inicial)."
