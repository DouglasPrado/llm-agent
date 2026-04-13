---
name: codegen
description: Orquestrador de codegen. Le build plan e guia execucao na ordem correta.
---

# Codegen — Orquestrador Mestre

Voce e o orquestrador do workflow de geracao de codigo a partir dos blueprints. Sua funcao e ler o build plan, apresentar as entregas e guiar o dev na execucao ordenada.

## Passo 1: Verificar Pre-requisitos

Verifique se os blueprints estao preenchidos:

1. Leia `docs/blueprint/11-build_plan.md` — se contem apenas `{{placeholders}}`, avise:
   > "O build plan ainda nao foi preenchido. Rode `/blueprint-buildplan` primeiro para definir as entregas do projeto."
   E pare aqui.

2. Verifique se o CLAUDE.md existe no projeto-alvo. Se nao:
   > "CLAUDE.md nao encontrado. Rode `/codegen-claudemd` para gerar o router de contexto."

3. Verifique se `src/contracts/` existe. Se nao:
   > "Contratos compartilhados nao encontrados. Rode `/codegen-contracts` para gerar o scaffold inicial."

## Passo 2: Leitura de Contexto

Leia os seguintes documentos:

1. `docs/blueprint/11-build_plan.md` — entregas, dependencias, criterios de aceite
2. `docs/blueprint/01-vision.md` — visao geral (para nao perder o norte)
3. `docs/blueprint/06-system-architecture.md` — stack e componentes (somente secao de Componentes)
4. `docs/backend/00-backend-vision.md` — stack e padroes do backend
5. `docs/shared/MAPPING.md` — rastreabilidade entre docs

## Passo 3: Identificar Clientes Frontend

Verifique quais clientes frontend existem:

```
docs/frontend/web/       → Cliente web
docs/frontend/mobile/    → Cliente mobile
docs/frontend/desktop/   → Cliente desktop
docs/frontend/shared/    → Design system, data layer, API deps (compartilhado)
```

Liste apenas os clientes que possuem docs preenchidos (nao apenas templates).

## Passo 4: Apresentar Status do Projeto

Analise o estado atual do projeto:

### 4.1: Identificar Entregas do Build Plan
Extraia todas as entregas com seus objetivos, itens e dependencias.

### 4.2: Verificar Progresso
Para cada entrega, verifique se os itens ja existem no codigo:
- Leia a estrutura de diretorios do projeto
- Verifique se os endpoints/componentes da entrega existem
- Classifique: **Nao iniciada** / **Em progresso** / **Concluida**

### 4.3: Apresentar Dashboard

> "## Status do Projeto
>
> **Visao:** {{elevator pitch de 01-vision}}
> **Stack:** {{resumo de 06-system-architecture}}
> **Clientes frontend:** {{web, mobile, desktop — apenas os que existem}}
>
> | Entrega | Prioridade | Status | Dependencias | Progresso |
> |---------|-----------|--------|--------------|-----------|
> | ENT-001: {{nome}} | {{Must/Should/Could}} | {{status}} | {{deps}} | {{X/Y}} itens |
> | ENT-002: {{nome}} | {{Must/Should/Could}} | {{status}} | {{deps}} | {{X/Y}} itens |
> | ... | ... | ... | ... | ... |
>
> **Proxima entrega recomendada:** {{nome}} ({{prioridade}}, dependencias satisfeitas)
> **Itens pendentes:**
> 1. {{item 1}} — use `/codegen-feature {{nome}}`
> 2. {{item 2}} — use `/codegen-feature {{nome}}`
> 3. {{item 3}} — use `/codegen-feature {{nome}}`
>
> Qual feature deseja implementar?"

## Passo 5: Guiar Execucao

Quando o dev escolher uma feature:

1. Valide que as dependencias estao satisfeitas (entregas dependentes concluidas)
2. Se houver dependencias nao atendidas, avise:
   > "Esta entrega depende de {{dependencia}} que ainda nao esta concluida. Recomendo implementar {{dependencia}} primeiro."
3. Se tudo ok, sugira:
   > "Rode `/codegen-feature {{nome-da-feature}}` para implementar."

## Passo 6: Verificacao de Entregas

Quando todas as entregas Must estiverem concluidas:

> "Todas as entregas Must foram implementadas.
>
> **Recomendacoes:**
> 1. Rode `/codegen-verify` para verificar aderencia ao blueprint
> 2. Execute a suite de testes completa
> 3. Faca uma tag de release
>
> Deseja continuar com as entregas Should?"

## Workflow

`/codegen-claudemd` (1x) → `/codegen-contracts` (1x) → `/codegen` (inicio sessao) → `/codegen-feature [nome]` (por feature) → `/codegen-verify` (periodico)
