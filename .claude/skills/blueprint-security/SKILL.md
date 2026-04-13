---
name: blueprint-security
description: Preenche 13-security.md — STRIDE, autenticacao, autorizacao e OWASP.
---

# Blueprint — Seguranca

Voce vai preencher a secao de Seguranca do blueprint. Seguranca nao e uma feature — e uma propriedade do sistema. Esta secao documenta como o sistema se protege.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primaria
2. Leia `docs/blueprint/05-data-model.md` — dados sensiveis e persistencia
3. Leia `docs/blueprint/06-system-architecture.md` — componentes e comunicacao
4. Leia `docs/blueprint/13-security.md` — template a preencher
5. Leia `docs/diagrams/sequences/auth-flow.mmd` — template de fluxo de autenticacao

## Analise de Lacunas

Identifique a partir do PRD e secoes anteriores:

- **Modelo de ameacas**: STRIDE aplicado aos componentes do sistema
- **Autenticacao**: OAuth, JWT, API keys, SSO, MFA — o PRD pode especificar ou nao
- **Autorizacao**: RBAC, ABAC — roles e permissoes
- **Dados sensiveis**: PII, dados financeiros — classificacao e protecao
- **Compliance**: LGPD, SOC2, PCI-DSS — regulamentacoes aplicaveis

Se o PRD nao especificar metodo de autenticacao ou regulamentacoes aplicaveis, pergunte ao usuario (max 3 perguntas).

## Geracao

> **Escrita:** Primeira vez (so placeholders) → Write. Reexecucao (conteudo real) → Edit (preservar existente, inserir antes de `<!-- APPEND:... -->`). Feature isolada → `/blueprint-increment`.

Preencha `docs/blueprint/13-security.md`:

- **Modelo de ameacas**: tabela STRIDE com ameaca, categoria, impacto e mitigacao
- **Autenticacao**: metodo, provedor, fluxo, politicas de credenciais
- **Autorizacao**: modelo, roles e permissoes, regras de acesso
- **Protecao de dados**: dados em transito (TLS), em repouso (criptografia), PII
- **Checklist OWASP**: status de cada item do Top 10
- **Auditoria e compliance**: regulamentacoes, logging, retencao, resposta a incidentes

## Diagrama

Atualize `docs/diagrams/sequences/auth-flow.mmd` com o fluxo de autenticacao real do sistema.

## Revisao

Apresente ao usuario. Aplique ajustes. Salve os arquivos finais.

## Proxima Etapa

> "Seguranca documentada. Rode `/blueprint-scalability` para definir a Escalabilidade."
