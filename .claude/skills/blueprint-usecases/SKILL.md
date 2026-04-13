---
name: blueprint-usecases
description: Preenche 08-use_cases.md — casos de uso com atores, fluxos e excecoes.
---

# Blueprint — Casos de Uso

Voce vai preencher a secao de Casos de Uso do blueprint. Casos de uso descrevem O QUE o sistema faz do ponto de vista do usuario, em formato estruturado.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria
2. Leia `docs/blueprint/04-domain-model.md` — entidades e regras de negocio
3. Leia `docs/blueprint/07-critical_flows.md` — fluxos ja documentados
4. Leia `docs/blueprint/08-use_cases.md` — template a preencher

## Analise de Lacunas

Extraia os casos de uso do PRD. Cada feature ou capacidade do sistema tipicamente corresponde a um ou mais casos de uso. Verifique se o PRD cobre:

- **Ator principal**: quem executa a acao
- **Pre-condicoes e pos-condicoes**: estado antes e depois
- **Fluxo principal**: caminho feliz passo a passo
- **Fluxos alternativos**: variacoes validas
- **Excecoes**: o que pode dar errado
- **Regras de negocio**: referencias a RN-XX do modelo de dominio

Se faltar clareza sobre fluxos alternativos ou excecoes, pergunte ao usuario (max 3 perguntas).

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/08-use_cases.md`. Para cada caso de uso:

- ID no formato UC-001, UC-002...
- Ator principal e atores secundarios
- Pre-condicao e pos-condicao
- Fluxo principal numerado
- Fluxos alternativos (1a, 2a...)
- Excecoes (E1, E2...)
- Referencias a regras de negocio (RN-XX) e requisitos (RF-XXX)

## Revisao

Apresente ao usuario. Aplique ajustes. Salve o arquivo final.

## Proxima Etapa

> "Casos de uso detalhados. Rode `/blueprint-states` para modelar os Estados das entidades."
