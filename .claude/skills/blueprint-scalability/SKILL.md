---
name: blueprint-scalability
description: Preenche 14-scalability.md — escalabilidade, caching, rate limiting e degradacao.
---

# Blueprint — Escalabilidade

Voce vai preencher a secao de Escalabilidade do blueprint. Esta secao define como o sistema cresce para atender demanda futura sem degradar performance.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria (projecoes de crescimento)
2. Leia `docs/blueprint/05-data-model.md` — volumes de dados
3. Leia `docs/blueprint/06-system-architecture.md` — componentes e infraestrutura
4. Leia `docs/blueprint/07-critical_flows.md` — fluxos com requisitos de performance
5. Leia `docs/blueprint/14-scalability.md` — template a preencher

## Analise de Lacunas

Identifique a partir do PRD e secoes anteriores:

- **Projecoes de crescimento**: usuarios, RPS, volume de dados em 6m e 12m
- **Gargalos atuais**: limites do sistema identificados
- **Estrategia de escala**: horizontal, vertical, particionamento
- **Cache**: o que cachear, TTL, invalidacao
- **Rate limiting**: limites por endpoint/usuario
- **Degradacao graciosa**: o que desligar primeiro sob carga

Se o PRD nao tiver projecoes de crescimento ou limites de escala, pergunte ao usuario (max 3 perguntas).

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/14-scalability.md`:

- **Estrategias de escala**: horizontal (quais servicos, balanceamento, auto-scaling), vertical, caching, sharding
- **Limites atuais**: tabela com metrica, limite atual, gargalo e acao
- **Plano de capacidade**: tabela com metrica, valor atual, projecao 6m e 12m
- **Cache**: tabela com item, TTL, estrategia de invalidacao
- **Rate limiting**: tabela com recurso, limite e resposta (HTTP 429)
- **Degradacao graciosa**: niveis de degradacao com trigger e acoes

## Diagramas

Atualize os diagramas de deploy para refletir escalabilidade:

- `docs/diagrams/deployment/production.mmd` — topologia basica
- `docs/diagrams/deployment/production-scaled.mmd` — topologia escalada (multi-AZ, replicas)

## Revisao

Apresente ao usuario. Aplique ajustes. Salve os arquivos finais.

## Proxima Etapa

> "Escalabilidade definida. Rode `/blueprint-observability` para configurar a Observabilidade."
