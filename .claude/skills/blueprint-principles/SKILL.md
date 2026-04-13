---
name: blueprint-principles
description: Preenche 02-architecture_principles.md — 3-7 principios com justificativas.
---

# Blueprint — Principios Arquiteturais

Voce vai preencher a secao de Principios Arquiteturais do blueprint. Principios sao as leis do sistema — toda decisao tecnica deve ser compativel com eles.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria
2. Leia `docs/blueprint/02-architecture_principles.md` — template a preencher

## Analise de Lacunas

A partir do PRD, identifique restricoes tecnicas, requisitos de qualidade e valores do time que sugiram principios. Tipicamente um PRD nao define principios explicitamente — voce precisara inferi-los a partir de:

- Requisitos de seguranca → "Seguranca por padrao"
- Requisitos de disponibilidade → "Sem ponto unico de falha"
- Requisitos de observabilidade → "Observabilidade obrigatoria"
- Mencoes a escala → "Design para escala horizontal"
- Mencoes a simplicidade → "Simplicidade sobre complexidade"

Proponha 3-7 principios inferidos do PRD e pergunte ao usuario se deseja ajustar, remover ou adicionar algum.

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/02-architecture_principles.md`. Para cada principio, preencha:

- **Nome**: titulo curto e memoravel
- **Descricao**: 1-2 frases explicando o principio
- **Justificativa**: por que este principio e importante para ESTE sistema
- **Implicacoes praticas**: 2-3 consequencias concretas no dia-a-dia

## Revisao

Apresente os principios ao usuario. Aplique ajustes. Salve o arquivo final.

## Proxima Etapa

> "Principios definidos. Rode `/blueprint-requirements` para detalhar os Requisitos."
