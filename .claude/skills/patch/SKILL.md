---
name: patch
description: Aplica uma alteracao em cascata por todos os documentos dos 3 blueprints (tecnico, frontend, business). Busca todas as ocorrencias e aplica patches com Edit.
---

# Patch — Edicao Propagada em Todos os Blueprints

Aplica uma alteracao (renomear, atualizar, corrigir) em cascata por todos os
41 documentos dos 3 blueprints. Faz varredura global, mostra impacto, e aplica
patches cirurgicos com Edit tool — nunca Write.

## Passo 1: Receber a Alteracao

Pergunte ao usuario:

> "Descreva a alteracao que precisa ser propagada:
>
> - **O que mudar:** termo, valor ou texto atual
> - **Pelo que mudar:** novo termo, valor ou texto
> - **Contexto (opcional):** motivo da mudanca
>
> Exemplos:
>
> - 'Renomear entidade `Booking` para `Appointment`'
> - 'Atualizar endpoint `/api/users` para `/api/v2/users`'
> - 'Mudar Next.js 16 para Next.js 17'
> - 'Corrigir nome do componente `UserCard` para `ProfileCard`'
> - 'Substituir Zustand por Jotai como state manager'"

Aguarde a resposta. Extraia:

- `OLD_TERM`: o que buscar
- `NEW_TERM`: pelo que substituir
- `CONTEXT`: motivo (opcional)

## Passo 2: Varredura Global

Use a **Grep tool** para buscar TODAS as ocorrencias do termo nos 4 diretorios:

```
docs/blueprint/*.md
docs/frontend/*.md
docs/business/*.md
```

Busque tambem variacoes de case do termo:

- **PascalCase**: `Booking`, `UserCard`
- **camelCase**: `booking`, `userCard`
- **kebab-case**: `booking`, `user-card`
- **UPPER_CASE**: `BOOKING`, `USER_CARD`
- **Compostos**: `bookingStore`, `BookingCard`, `useBooking`, `booking-service`

Use regex case-insensitive quando apropriado para capturar todas as variacoes.

## Passo 3: Analise de Impacto

Classifique cada ocorrencia em 3 tipos:

### Substituicao Direta

O termo aparece literalmente. Substituir automaticamente.

- Ex: `Booking` → `Appointment`

### Substituicao Contextual

O termo aparece como parte de um nome derivado. Substituir adaptando o case.

- Ex: `bookingStore` → `appointmentStore`
- Ex: `BookingCard` → `AppointmentCard`
- Ex: `useBooking` → `useAppointment`
- Ex: `/api/booking` → `/api/appointment`

### Referencia Indireta

O termo aparece em prosa descritiva ou explicacao. Marcar para revisao do usuario.

- Ex: "o sistema de booking permite..." → flag para revisao

Apresente tabela ao usuario:

| #   | Arquivo                      | Linha | Tipo       | Antes                | Depois           |
| --- | ---------------------------- | ----- | ---------- | -------------------- | ---------------- |
| 1   | blueprint/04-domain-model.md | 23    | Direta     | Booking              | Appointment      |
| 2   | frontend/05-state.md         | 45    | Contextual | bookingStore         | appointmentStore |
| 3   | frontend/04-components.md    | 67    | Contextual | BookingCard          | AppointmentCard  |
| 4   | business/03-canais.md        | 12    | Indireta   | "sistema de booking" | (revisar)        |

## Passo 4: Confirmacao

Apresente resumo e peca confirmacao:

> "Encontrei **{{N}}** ocorrencias em **{{M}}** arquivos:
>
> - **{{X}}** substituicoes diretas (aplicarei automaticamente)
> - **{{Y}}** substituicoes contextuais (aplicarei com adaptacao de case)
> - **{{Z}}** referencias indiretas (marcarei para sua revisao)
>
> | Diretorio  | Arquivos | Ocorrencias |
> | ---------- | -------- | ----------- |
> | blueprint/ | {{n}}    | {{x}}       |
> | frontend/  | {{n}}    | {{x}}       |
> | business/  | {{n}}    | {{x}}       |
>
> Deseja prosseguir? Quer excluir algum arquivo ou ocorrencia?"

Aguarde confirmacao antes de aplicar.

## Passo 5: Aplicar Patches

Para CADA ocorrencia confirmada:

1. **Leia** o arquivo (Read tool)
2. **Aplique** Edit tool com old_string exato → new_string
3. Para substituicoes contextuais: adapte o case automaticamente

### Regras de case:

| Case Original       | Exemplo Old         | Exemplo New             |
| ------------------- | ------------------- | ----------------------- |
| PascalCase          | `Booking`           | `Appointment`           |
| camelCase           | `booking`           | `appointment`           |
| kebab-case          | `booking-card`      | `appointment-card`      |
| UPPER_CASE          | `BOOKING`           | `APPOINTMENT`           |
| Composto camelCase  | `bookingStore`      | `appointmentStore`      |
| Composto PascalCase | `BookingCard`       | `AppointmentCard`       |
| Prefixo use         | `useBooking`        | `useAppointment`        |
| Path                | `/api/booking`      | `/api/appointment`      |
| Feature dir         | `features/booking/` | `features/appointment/` |

### Regras criticas — NUNCA violar:

- **SEMPRE usar Edit tool, NUNCA Write tool**
- **Respeitar case**: manter o padrao de case do contexto original
- **Uma Edit por ocorrencia**: nao agrupar multiplas substituicoes em um Edit
- **NAO alterar** marcadores `<!-- APPEND:... -->` ou `<!-- patch:... -->`
- **NAO alterar** conteudo dentro de `<details>` blocos de exemplo generico (a menos que o termo apareca literalmente no exemplo especifico do projeto)
- **NAO alterar** placeholders `{{...}}` — eles sao templates, nao dados reais

### Para referencias indiretas:

Marque com comentario para revisao manual:

```
<!-- PATCH-REVIEW: "booking" pode precisar de atualizacao neste contexto -->
```

O usuario revisara esses trechos manualmente.

## Passo 6: Relatorio

Apresente resumo final:

> "**Patch aplicado:** `{{OLD_TERM}}` → `{{NEW_TERM}}`
>
> | Diretorio  | Arquivos alterados | Substituicoes |
> | ---------- | ------------------ | ------------- |
> | blueprint/ | {{N}}              | {{X}}         |
> | frontend/  | {{N}}              | {{X}}         |
> | business/  | {{N}}              | {{X}}         |
> | **Total**  | **{{N}}**          | **{{X}}**     |
>
> **{{Z}} referencias indiretas** marcadas com `<!-- PATCH-REVIEW -->` para revisao manual:
>
> - `arquivo:linha` — contexto
>
> Para encontrar todas as marcacoes pendentes:
> `grep -rn 'PATCH-REVIEW' docs/`"

## Passo 7: Proximo

> "Patch completo. Para aplicar outro patch, rode `/patch` novamente.
> Para revisar um blueprint especifico, rode `/blueprint`, `/frontend` ou `/business`.
> Para remover marcacoes PATCH-REVIEW apos revisao: `/patch` com instrucao de limpeza."

---

## Casos de Uso

| Caso                | Comando                                        | Escopo                                                |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| Renomear entidade   | `/patch` "Booking → Appointment"               | domain, data, flows, components, state, hooks         |
| Atualizar endpoint  | `/patch` "/api/users → /api/v2/users"          | data-layer, architecture, flows                       |
| Mudar tecnologia    | `/patch` "Zustand → Jotai"                     | frontend (estado, visao, cicd), blueprint (decisions) |
| Atualizar versao    | `/patch` "Next.js 16 → Next.js 17"             | frontend (visao), blueprint (decisions)               |
| Renomear componente | `/patch` "UserCard → ProfileCard"              | frontend (componentes, fluxos, testes)                |
| Corrigir metrica    | `/patch` "Churn Rate 5% → Churn Rate 3%"       | business (metricas, relacionamento)                   |
| Renomear feature    | `/patch` "features/auth/ → features/identity/" | frontend (estrutura, componentes), blueprint          |
