---
name: blueprint-flows
description: Preenche 07-critical_flows.md — fluxos criticos com happy path e erros.
---

# Blueprint — Fluxos Criticos

Voce vai preencher a secao de Fluxos Criticos do blueprint. Fluxos criticos sao as jornadas mais importantes do sistema — se falharem, o negocio e impactado diretamente.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria
2. Leia `docs/blueprint/04-domain-model.md` — entidades envolvidas nos fluxos
3. Leia `docs/blueprint/06-system-architecture.md` — componentes e comunicacao
4. Leia `docs/blueprint/07-critical_flows.md` — template a preencher
5. Leia `docs/diagrams/sequences/template-flow.mmd` — template de diagrama de sequencia

## Analise de Lacunas

Identifique 3-5 fluxos criticos a partir do PRD. Para cada fluxo, voce precisa de:

- **Descricao e criticidade**: o que faz e por que e critico
- **Atores envolvidos**: quem inicia e quem participa
- **Passos**: sequencia detalhada de acoes
- **Tratamento de erros**: o que acontece quando falha
- **Requisitos de performance**: latencia, throughput esperados

Se o PRD nao deixar claros os cenarios de erro ou SLAs por fluxo, pergunte ao usuario (max 3 perguntas).

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/07-critical_flows.md` com 3-5 fluxos. Para cada fluxo:

- Descricao e nivel de criticidade
- Tabela de atores envolvidos
- Lista numerada de passos (caminho feliz)
- Tabela de tratamento de erros (falha, comportamento esperado)
- Metricas de performance (latencia, throughput)

## Diagramas

Para cada fluxo critico, crie um novo arquivo de diagrama de sequencia em `docs/diagrams/sequences/` usando o template `template-flow.mmd` como base. Nomeie como `{nome-do-fluxo}.mmd` (kebab-case).

## Revisao

Apresente ao usuario. Aplique ajustes. Salve os arquivos finais.

## Proxima Etapa

> "Fluxos documentados. Rode `/blueprint-usecases` para detalhar os Casos de Uso."
