---
name: blueprint
description: Inicia blueprint tecnico a partir de um PRD. Analisa lacunas e guia o preenchimento.
---

# Blueprint — Orquestrador de Documentacao

Voce e o orquestrador do preenchimento do Blueprint de Software. Sua funcao e receber o PRD, salva-lo e guiar o usuario pela documentacao passo a passo.

## Passo 1: Receber o PRD

Verifique se o usuario passou um argumento (caminho de arquivo). Se sim, leia o arquivo. Se nao, pergunte:

> "Para iniciar o blueprint, preciso do seu PRD (Product Requirements Document). Voce pode:
> 1. Passar o caminho do arquivo: `/blueprint docs/prd.md`
> 2. Colar o conteudo do PRD aqui no chat
>
> Como prefere?"

Aguarde a resposta do usuario.

## Passo 2: Salvar o PRD

Salve o conteudo do PRD em `docs/prd.md` na raiz do projeto. Se o arquivo ja existir, pergunte se deve sobrescrever.

## Passo 3: Analisar o PRD

Leia o PRD e analise a cobertura para cada secao do blueprint. Para cada secao, classifique:

- **Coberto**: o PRD tem informacao suficiente para preencher
- **Parcial**: o PRD tem alguma informacao mas faltam detalhes
- **Lacuna**: o PRD nao cobre esta secao

Apresente o resultado em tabela:

| # | Secao | Cobertura | Observacao |
|---|-------|-----------|------------|
| 1 | Contexto | Coberto/Parcial/Lacuna | breve nota |
| 2 | Visao | ... | ... |
| ... | ... | ... | ... |

## Passo 4: Apresentar o Roadmap

Apresente a ordem recomendada de preenchimento:

```
1.  /blueprint-context        — Contexto do Sistema
2.  /blueprint-vision         — Visao e Objetivos
3.  /blueprint-principles     — Principios Arquiteturais
4.  /blueprint-requirements   — Requisitos
5.  /blueprint-domain         — Modelo de Dominio
6.  /blueprint-data           — Modelo de Dados
7.  /blueprint-architecture   — Arquitetura do Sistema
8.  /blueprint-flows          — Fluxos Criticos
9.  /blueprint-usecases       — Casos de Uso
10. /blueprint-states         — Modelos de Estado
11. /blueprint-decisions      — Decisoes Arquiteturais
12. /blueprint-buildplan      — Plano de Construcao
13. /blueprint-testing        — Estrategia de Testes
14. /blueprint-security       — Seguranca
15. /blueprint-scalability    — Escalabilidade
16. /blueprint-observability  — Observabilidade
17. /blueprint-evolution      — Evolucao e Migracao
18. /blueprint-communication — Comunicacao (Email, SMS, WhatsApp)
```

## Passo 5: Orientar o Proximo Passo

Diga ao usuario:

> "PRD salvo e analisado. Rode `/blueprint-context` para comecar pelo Contexto do Sistema."
