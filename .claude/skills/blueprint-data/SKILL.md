---
name: blueprint-data
description: Preenche 05-data-model.md — banco, schemas, migrations, indices e queries.
---

# Blueprint — Modelo de Dados

Voce vai preencher a secao de Modelo de Dados do blueprint. Esta secao traduz o modelo de dominio conceitual em decisoes concretas de persistencia.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria
2. Leia `docs/blueprint/04-domain-model.md` — entidades e relacionamentos ja definidos
3. Leia `docs/blueprint/05-data-model.md` — template a preencher

## Analise de Lacunas

A partir do PRD e do modelo de dominio, identifique:

- **Tecnologia de banco**: PostgreSQL, MongoDB, Redis, etc. — o PRD pode mencionar ou nao
- **Volume de dados e crescimento**: necessario para decisoes de indexacao e particionamento
- **Padroes de leitura/escrita**: afetam escolha de indices e cache
- **Requisitos de consistencia**: forte vs eventual

Se o PRD nao especificar a tecnologia de banco ou volumes esperados, pergunte ao usuario (max 3 perguntas).

## Regra de Nomenclatura

- **Nomes de tabelas, campos, indices e constraints**: sempre em ingles
- **Comentarios e descricoes**: sempre em portugues

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/05-data-model.md`:

- **Banco de Dados**: tecnologia escolhida e justificativa
- **Tabelas/Collections**: para cada uma, liste campos com tipo, constraint e descricao (nomes em ingles, descricoes em portugues)
- **Estrategia de Migracao**: ferramenta e abordagem
- **Indices e Otimizacoes**: indices criticos por tabela
- **Queries Criticas**: tabela com query, frequencia e SLA esperado

## Diagrama

Atualize `docs/diagrams/domain/er-diagram.mmd` com as tabelas e campos reais (se nao foi feito na etapa de dominio, ou refine o existente com detalhes fisicos).

## Revisao

Apresente ao usuario. Aplique ajustes. Salve os arquivos finais.

## Proxima Etapa

> "Modelo de dados definido. Rode `/blueprint-architecture` para desenhar a Arquitetura do Sistema."
