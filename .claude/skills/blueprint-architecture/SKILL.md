---
name: blueprint-architecture
description: Preenche 06-system-architecture.md — componentes, protocolos, infra e deploy.
---

# Blueprint — Arquitetura do Sistema

Voce vai preencher a secao de Arquitetura do Sistema do blueprint. Esta secao descreve os blocos principais do sistema, como eles se comunicam e onde sao implantados.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria
2. Leia `docs/blueprint/02-architecture_principles.md` — principios que guiam as decisoes
3. Leia `docs/blueprint/04-domain-model.md` — entidades e bounded contexts
4. Leia `docs/blueprint/05-data-model.md` — tecnologias de persistencia
5. Leia `docs/blueprint/06-system-architecture.md` — template a preencher

## Analise de Lacunas

Identifique a partir do PRD e secoes anteriores:

- **Componentes**: quais servicos, apps, workers o sistema precisa
- **Comunicacao**: REST, gRPC, eventos, filas — sincrono vs assincrono
- **Infraestrutura**: cloud provider, orquestracao, CI/CD, monitoramento
- **Ambientes**: dev, staging, prod — URLs e configuracoes

Se o PRD nao especificar stack tecnologico ou infraestrutura, proponha opcoes e pergunte ao usuario (max 3 perguntas).

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/06-system-architecture.md`:

- **Componentes**: para cada um, preencha nome, responsabilidade, tecnologia e interface
- **Comunicacao**: tabela com origem, destino, protocolo, tipo (sync/async) e descricao
- **Infraestrutura**: tabela com ambientes, decisoes de infra (cloud, orquestracao, CI/CD, banco, cache, mensageria)

## Diagramas

Atualize estes diagramas Mermaid:

- `docs/diagrams/containers/container-diagram.mmd` — containers (apps, APIs, bancos, filas)
- `docs/diagrams/components/api-components.mmd` — componentes internos do container principal
- `docs/diagrams/deployment/production.mmd` — topologia de deploy em producao

## Revisao

Apresente ao usuario. Aplique ajustes. Salve os arquivos finais.

## Proxima Etapa

> "Arquitetura definida. Rode `/blueprint-flows` para documentar os Fluxos Criticos."
