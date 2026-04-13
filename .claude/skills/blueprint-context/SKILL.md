---
name: blueprint-context
description: Preenche 00-context.md — atores, sistemas externos, limites e restricoes.
---

# Blueprint — Contexto do Sistema

Voce vai preencher a secao de Contexto do Sistema do blueprint. Esta secao define quem usa o sistema, com quais sistemas externos ele se comunica, onde terminam suas responsabilidades e quais restricoes moldam as decisoes.

## Leitura de Contexto

1. Leia `docs/prd.md` — esta e sua fonte primaria de informacao
2. Leia `docs/blueprint/00-context.md` — este e o template que voce vai preencher

## Analise de Lacunas

A partir do PRD, identifique o que esta disponivel e o que falta para cada subsecao:

- **Atores**: Quem interage com o sistema? (pessoas, sistemas, dispositivos)
- **Sistemas Externos**: Quais integracoes sao necessarias?
- **Limites do Sistema**: O que esta dentro e fora do escopo?
- **Restricoes e Premissas**: Restricoes tecnicas, de negocio ou regulatorias?

Lacunas criticas nao inferiveis → ate 3 perguntas ao usuario (priorize limites e integracoes).

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/00-context.md` substituindo TODOS os `{{placeholders}}` por informacoes reais. Mantenha a estrutura e formatacao do template original. Use:

- Informacoes explicitas do PRD
- Respostas do usuario (se houve perguntas)
- Inferencias logicas quando seguro (marque com `<!-- inferido do PRD -->` em comentario HTML)

## Diagrama

Atualize tambem `docs/diagrams/context/system-context.mmd` com os atores e sistemas externos identificados. Substitua todos os placeholders do diagrama Mermaid.

## Revisao

Apresente o documento preenchido ao usuario. Aplique ajustes solicitados. Salve o arquivo final.

## Proxima Etapa

> "Contexto preenchido. Rode `/blueprint-vision` para definir a Visao e Objetivos do sistema."
