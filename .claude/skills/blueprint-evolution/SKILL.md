---
name: blueprint-evolution
description: Preenche 16-evolution.md — roadmap tecnico, tech debt, versionamento e deprecacao.
---

# Blueprint — Evolucao e Migracao

Voce vai preencher a secao de Evolucao e Migracao do blueprint. Esta e a ultima secao — define como o sistema evolui ao longo do tempo, gerencia divida tecnica e mantem a documentacao atualizada.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria (visao de longo prazo)
2. Leia `docs/blueprint/10-architecture_decisions.md` — decisoes e trade-offs aceitos
3. Leia `docs/blueprint/11-build_plan.md` — entregas e roadmap
4. Leia `docs/blueprint/14-scalability.md` — limites atuais e projecoes
5. Leia `docs/blueprint/16-evolution.md` — template a preencher

## Analise de Lacunas

Identifique a partir do PRD e secoes anteriores:

- **Roadmap tecnico**: melhorias planejadas alem do MVP
- **Divida tecnica**: trade-offs aceitos nas decisoes que geram debito
- **Versionamento**: SemVer para o sistema, versionamento de API
- **Deprecacao**: funcionalidades a serem removidas e timeline
- **Revisao do blueprint**: quando e como revisar esta documentacao

Se o PRD nao cobrir visao de longo prazo ou estrategia de versionamento, pergunte ao usuario (max 3 perguntas).

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/16-evolution.md`:

- **Roadmap tecnico**: tabela com item, prioridade, justificativa e entrega associada
- **Debitos tecnicos**: tabela com debito, impacto, esforco e prioridade
- **Versionamento**: versao atual, estrategia SemVer, versionamento de API (URI, header, etc.)
- **Deprecacao**: tabela com funcionalidade, data de deprecacao, periodo de transicao e alternativa
- **Revisao do blueprint**: gatilhos de revisao, cadencia e responsavel
- **Historico de revisoes**: tabela inicial com data de criacao

## Revisao

Apresente ao usuario. Aplique ajustes. Salve o arquivo final.

## Conclusao

> "Blueprint completo! Todas as 17 secoes foram preenchidas. Revise o documento master em `docs/blueprint/README.MD` para uma visao consolidada. Os diagramas estao em `docs/diagrams/`."
