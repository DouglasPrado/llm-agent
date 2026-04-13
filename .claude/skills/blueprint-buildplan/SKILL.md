---
name: blueprint-buildplan
description: Preenche 11-build_plan.md — entregas, prioridades, dependencias e riscos.
---

# Blueprint — Plano de Construcao

Voce vai preencher a secao de Plano de Construcao do blueprint. O plano de construcao transforma a arquitetura em um roadmap executavel com entregas priorizadas, dependencias e riscos.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria (prazos, prioridades, MVP)
2. Leia `docs/blueprint/03-requirements.md` — requisitos priorizados
3. Leia `docs/blueprint/07-critical_flows.md` — fluxos criticos (determinam ordem)
4. Leia `docs/blueprint/08-use_cases.md` — casos de uso (escopo de cada entrega)
5. Leia `docs/blueprint/11-build_plan.md` — template a preencher

## Analise de Lacunas

Identifique a partir do PRD:

- **Entregas**: o PRD define entregas priorizadas? Quais sao Must vs Should vs Could?
- **Prioridades**: quais features primeiro?
- **Riscos tecnicos**: dependencias externas, complexidade, incertezas
- **Dependencias externas**: equipes, sistemas, parceiros

Se o PRD nao definir prioridades claras, proponha entregas baseadas nos requisitos Must/Should/Could e pergunte ao usuario (max 3 perguntas).

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/11-build_plan.md`:

- **Entregas**: lista de entregas com objetivo, itens, dependencias explicitas entre entregas, criterios de aceite e prioridade (Must/Should/Could). Estimativas em T-shirt (S/M/L/XL). Use IDs sequenciais (ENT-001, ENT-002, etc.)
- **Priorizacao**: tabela com entrega, prioridade, dependencias e justificativa
- **Riscos tecnicos**: tabela com descricao, probabilidade, impacto e mitigacao
- **Dependencias externas**: tabela com sistema/equipe, tipo, responsavel e status

## Revisao

Apresente ao usuario. Aplique ajustes. Salve o arquivo final.

## Proxima Etapa

> "Plano de construcao definido. Rode `/blueprint-testing` para definir a Estrategia de Testes."
