---
name: blueprint-states
description: Preenche 09-state-models.md — maquinas de estado com transicoes e triggers.
---

# Blueprint — Modelos de Estado

Voce vai preencher a secao de Modelos de Estado do blueprint. Modelos de estado descrevem o ciclo de vida das entidades cujo comportamento depende do estado em que se encontram.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria
2. Leia `docs/blueprint/04-domain-model.md` — entidades e seus status
3. Leia `docs/blueprint/08-use_cases.md` — acoes que mudam estados
4. Leia `docs/blueprint/09-state-models.md` — template a preencher
5. Leia `docs/diagrams/domain/state-template.mmd` — template de diagrama de estados

## Analise de Lacunas

Identifique no modelo de dominio quais entidades possuem campo de status ou ciclo de vida relevante (ex: pedido, pagamento, assinatura, job, tarefa). Para cada uma, voce precisa de:

- **Estados possiveis**: lista completa com descricao
- **Transicoes**: de qual estado para qual, por qual gatilho, sob qual condicao
- **Transicoes proibidas**: o que NAO pode acontecer
- **Acoes por transicao**: emitir evento, auditar, atualizar timestamp

Se o PRD nao detalhar transicoes ou restricoes de estado, pergunte ao usuario (max 3 perguntas).

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/09-state-models.md`. Para cada entidade com ciclo de vida:

- Nome e descricao da entidade
- Tabela de estados possiveis com descricao
- Tabela de transicoes: De, Para, Gatilho, Condicao
- Lista de transicoes proibidas

## Diagramas

Para cada entidade com ciclo de vida, crie um diagrama de estados em `docs/diagrams/domain/` usando o template `state-template.mmd` como base. Nomeie como `state-{entidade}.mmd` (kebab-case).

## Revisao

Apresente ao usuario. Aplique ajustes. Salve os arquivos finais.

## Proxima Etapa

> "Estados modelados. Rode `/blueprint-decisions` para registrar as Decisoes Arquiteturais."
