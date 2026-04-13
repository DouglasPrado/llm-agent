---
name: blueprint-domain
description: Preenche 04-domain-model.md — linguagem ubiqua, entidades, regras e relacoes.
---

# Blueprint — Modelo de Dominio

Voce vai preencher a secao de Modelo de Dominio do blueprint. O modelo de dominio e o coracao conceitual do sistema — define as entidades, seus atributos, regras de negocio e relacionamentos.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria
2. Leia `docs/blueprint/00-context.md` — atores e limites do sistema
3. Leia `docs/blueprint/01-vision.md` — objetivos e personas
4. Leia `docs/blueprint/04-domain-model.md` — template a preencher

## Analise de Lacunas

Extraia do PRD as entidades de negocio, seus atributos e regras. Se o PRD for vago sobre:

- **Glossario ubiquo**: termos do dominio que precisam de definicao unica
- **Invariantes**: regras que NUNCA podem ser violadas
- **Cardinalidade dos relacionamentos**: 1:1, 1:N, N:M

Faca ate 3 perguntas ao usuario focando em regras de negocio — estas sao as mais dificeis de inferir.

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/04-domain-model.md`:

- **Glossario Ubiquo**: tabela com termos e definicoes oficiais
- **Entidades**: para cada uma, liste atributos (campo, tipo, obrigatorio, descricao), regras de negocio e eventos de dominio
- **Relacionamentos**: tabela com entidade A, tipo, cardinalidade, entidade B e regra

## Diagramas

Atualize estes diagramas Mermaid substituindo todos os placeholders:

- `docs/diagrams/domain/class-diagram.mmd` — diagrama de classes com entidades e relacionamentos
- `docs/diagrams/domain/er-diagram.mmd` — diagrama ER com tabelas e campos

## Revisao

Apresente ao usuario. Aplique ajustes. Salve os arquivos finais.

## Proxima Etapa

> "Dominio modelado. Rode `/blueprint-data` para definir o Modelo de Dados."
