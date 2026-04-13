---
name: blueprint-requirements
description: Preenche 03-requirements.md — requisitos funcionais e nao-funcionais (MoSCoW).
---

# Blueprint — Requisitos

Voce vai preencher a secao de Requisitos do blueprint. Requisitos definem O QUE o sistema precisa fazer (funcionais) e COMO deve se comportar (nao funcionais).

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria
2. Leia `docs/blueprint/01-vision.md` — objetivos e metricas ja definidos
3. Leia `docs/blueprint/03-requirements.md` — template a preencher

## Analise de Lacunas

Extraia do PRD:

- **Requisitos Funcionais**: funcionalidades, features, capacidades do sistema. Classifique cada um com MoSCoW (Must/Should/Could/Won't).
- **Requisitos Nao Funcionais**: performance (latencia, throughput), disponibilidade (SLA), seguranca, escalabilidade, manutenibilidade. Defina metricas e thresholds concretos.
- **Matriz de Priorizacao**: valor de negocio vs esforço tecnico vs risco.

Se o PRD nao tiver SLAs ou metas de performance claras, pergunte ao usuario (max 3 perguntas).

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/03-requirements.md`:

- Tabela de requisitos funcionais com ID (RF-001, RF-002...), descricao, prioridade MoSCoW e status
- Tabela de requisitos nao funcionais com categoria, requisito, metrica e threshold
- Matriz de priorizacao com valor de negocio (1-5), esforco tecnico (1-5), risco (1-5)

Garanta rastreabilidade: cada requisito funcional deve se conectar a um objetivo da secao de Visao.

## Revisao

Apresente ao usuario. Aplique ajustes. Salve o arquivo final.

## Proxima Etapa

> "Requisitos definidos. Rode `/blueprint-domain` para modelar o Dominio."
