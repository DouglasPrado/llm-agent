---
name: blueprint-testing
description: Preenche 12-testing_strategy.md — piramide de testes, cobertura e CI/CD.
---

# Blueprint — Estrategia de Testes

Voce vai preencher a secao de Estrategia de Testes do blueprint. Esta secao define como o sistema sera testado em cada camada para garantir qualidade e confianca nas entregas.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria
2. Leia `docs/blueprint/06-system-architecture.md` — componentes e stack tecnologico
3. Leia `docs/blueprint/07-critical_flows.md` — fluxos criticos a cobrir com testes
4. Leia `docs/blueprint/12-testing_strategy.md` — template a preencher

## Analise de Lacunas

Identifique a partir das secoes anteriores:

- **Stack tecnologico**: determina ferramentas de teste (Jest, PyTest, etc.)
- **Fluxos criticos**: determinam testes E2E prioritarios
- **Requisitos de performance**: determinam testes de carga
- **Integracoes externas**: determinam testes de contrato

Se o PRD nao mencionar requisitos de cobertura ou ferramentas de teste, proponha valores padrao e pergunte ao usuario (max 3 perguntas).

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/12-testing_strategy.md`:

- **Piramide**: proporcao sugerida (ex: 70% unit, 20% integration, 10% E2E)
- **Categorias**: para cada tipo (unit, integration, E2E, load, chaos), preencha objetivo, escopo, ferramentas e criterios de sucesso
- **Cobertura minima**: tabela com camada, cobertura minima e justificativa
- **Ambientes de teste**: tabela com ambiente, proposito e dados utilizados
- **Automacao e CI**: tabela com etapa do pipeline, testes executados, gatilho e se e bloqueante

## Revisao

Apresente ao usuario. Aplique ajustes. Salve o arquivo final.

## Proxima Etapa

> "Estrategia de testes definida. Rode `/blueprint-security` para documentar a Seguranca."
