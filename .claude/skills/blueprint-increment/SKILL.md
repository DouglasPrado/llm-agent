---
name: blueprint-increment
description: Incrementa blueprint tecnico sem sobrescrever. Usa Edit para preservar conteudo.
---

# Blueprint Tecnico — Incrementar ou Corrigir

Atualiza docs do blueprint tecnico de forma incremental (Edit, nunca Write).
Tipos: **Adicionar** feature | **Corrigir** dados | **Atualizar** versoes/nomes | **Remover** do escopo.

## Passo 1: Receber a Alteracao

Pergunte: "O que precisa ser atualizado no blueprint tecnico? (nova feature, correcao, atualizacao ou remocao)"

## Passo 2: Leitura

Leia todos os docs em `docs/blueprint/` (00 a 16) e `docs/prd.md` se existir.

> **Versoes:** Para tecnologias com versao, consulte via `mcp__context7__resolve-library-id` → `mcp__context7__query-docs`.

## Passo 3: Classificar e Analisar Impacto

Classifique (Adicao/Correcao/Atualizacao/Remocao) e apresente tabela de impacto:

| Doc | Impactado? | Tipo | O que fazer |
|-----|-----------|------|-------------|
| 00 a 16 | Sim/Nao | Tipo | Descricao |

Confirme com o usuario antes de prosseguir.

## Passo 4: Aplicar Alteracoes

**SEMPRE Edit, NUNCA Write.**

### ADICAO:
Localize `<!-- APPEND:section-id -->` → insira conteudo novo ANTES do marcador → marque com `<!-- adicionado: nome -->`.

**Marcadores disponiveis:**
- `00`: `actors`, `external-systems`, `constraints`
- `01`: `objectives`, `personas`, `success-metrics`
- `03`: `functional-requirements`, `nonfunctional-requirements`
- `04`: `glossary`, `entities`
- `09`: `state-models` | `10`: `adrs`
- `11`: `technical-risks`, `deliverables`
- `12`: `coverage`, `ci-pipeline`
- `13`: `threats`, `roles`

Docs sem APPEND (02, 05, 06, 07, 08, 14, 15, 16) → insira na secao apropriada apos ultima entrada.

### CORRECAO:
Edit com old_string=valor antigo, new_string=valor correto. Marque `<!-- corrigido: descricao -->`. NAO toque outras linhas.

### ATUALIZACAO:
Localize TODAS ocorrencias. Use replace_all se multiplas no mesmo arquivo. Marque `<!-- atualizado: descricao -->`.

### REMOCAO:
Substitua por `~~conteudo~~ <!-- removido: motivo -->` (strikethrough). Delete so se usuario confirmar.

### Regras:
- Tabelas: novas linhas ANTES de `<!-- APPEND:... -->`
- Fluxos/Casos de uso/ADRs: novo bloco com numeracao sequencial
- NUNCA altere linhas nao relacionadas. Alteracoes minimas.

### Exemplo (tabela):
`<!-- APPEND:actors -->` → Edit: old=marcador, new=nova linha + marcador

## Passo 5: Revisao

Resuma: "Alteracao aplicada em **N** docs:" + tabela de mudancas.

> "Para outra alteracao: `/blueprint-increment`. Para revisar completo: `/blueprint`."
