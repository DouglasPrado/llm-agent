---
name: blueprint-observability
description: Preenche 15-observability.md — logs, metricas, tracing, alertas e dashboards.
---

# Blueprint — Observabilidade

Voce vai preencher a secao de Observabilidade do blueprint. Se voce nao consegue observar, voce nao consegue operar. Esta secao define como o sistema sera monitorado.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria
2. Leia `docs/blueprint/06-system-architecture.md` — componentes e stack
3. Leia `docs/blueprint/14-scalability.md` — metricas e thresholds de escala
4. Leia `docs/blueprint/15-observability.md` — template a preencher

## Analise de Lacunas

Identifique a partir das secoes anteriores:

- **Logs**: formato, niveis, retencao, eventos criticos
- **Metricas**: Golden Signals (latencia, trafego, erros, saturacao) + metricas custom
- **Tracing**: ferramenta, protocolo de propagacao, taxa de amostragem
- **Alertas**: condicoes, severidades (P1-P4), politica de escalacao
- **Dashboards**: operacional e de negocio
- **Health checks**: liveness e readiness

Se o PRD nao mencionar ferramentas de monitoramento ou politica de alertas, proponha opcoes e pergunte ao usuario (max 3 perguntas).

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/15-observability.md`:

- **Logs**: formato JSON estruturado com exemplo, niveis, retencao por ambiente
- **Metricas**: tabela Golden Signals com thresholds + metricas custom
- **Tracing**: ferramenta, convencoes de spans, taxa de amostragem
- **Alertas**: tabela com alerta, severidade, condicao e runbook. Tabela de severidades com SLA de resposta. Politica de escalacao em 3 etapas.
- **Dashboards**: tabela com nome, publico-alvo e metricas incluidas
- **Health checks**: endpoints de liveness e readiness com resposta JSON esperada

## Revisao

Apresente ao usuario. Aplique ajustes. Salve o arquivo final.

## Proxima Etapa

> "Observabilidade configurada. Rode `/blueprint-evolution` para a ultima etapa: Evolucao e Migracao."
