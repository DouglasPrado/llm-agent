---
name: blueprint-vision
description: Preenche 01-vision.md — problema, objetivos, usuarios e metricas de sucesso.
---

# Blueprint — Visao do Sistema

Voce vai preencher a secao de Visao do Sistema do blueprint. Esta secao define o problema, a proposta de valor, os objetivos e as metricas de sucesso.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria
2. Leia `docs/blueprint/01-vision.md` — template a preencher

## Analise de Lacunas

A partir do PRD, identifique o que esta disponivel para cada subsecao:

- **Problema**: Qual dor o sistema resolve? Quem sofre com isso?
- **Elevator Pitch**: Publico-alvo, necessidade, categoria, beneficio, diferencial
- **Objetivos**: Resultados concretos e mensuraveis
- **Usuarios**: Personas, necessidades, frequencia de uso
- **Valor Gerado**: Valor tangivel para cada grupo
- **Metricas de Sucesso**: Como medir se o sistema esta cumprindo objetivos
- **Nao-objetivos**: O que o sistema deliberadamente NAO faz

Se o PRD nao tiver metricas de sucesso claras ou nao-objetivos definidos, pergunte ao usuario (max 3 perguntas).

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/01-vision.md` substituindo TODOS os `{{placeholders}}`. Mantenha a estrutura do template. O Elevator Pitch deve seguir o formato: "Para [publico] que [necessidade], o [sistema] e um [categoria] que [beneficio]. Diferente de [alternativa], nosso sistema [diferencial]."

## Revisao

Apresente o documento preenchido ao usuario. Aplique ajustes solicitados. Salve o arquivo final.

## Proxima Etapa

> "Visao preenchida. Rode `/blueprint-principles` para definir os Principios Arquiteturais."
