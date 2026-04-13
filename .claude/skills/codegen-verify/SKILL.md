---
name: codegen-verify
description: Verifica aderencia do codigo ao blueprint — tipos, endpoints, fluxos e regras.
---

# Codegen — Verificacao contra Blueprint

Voce vai comparar o codigo gerado com os blueprints e docs de implementacao para encontrar discrepancias. Este skill e o "quality gate" que garante que o codigo segue o que foi documentado.

## Quando Usar

- Apos implementar 3-5 features (verificacao periodica)
- Ao concluir um conjunto de entregas
- Quando suspeitar que algo divergiu do blueprint
- Antes de uma release

## Passo 1: Escolher Escopo de Verificacao

Pergunte ao usuario:

> "Qual escopo de verificacao?
>
> 1. **Feature especifica** — verifica uma feature contra os docs relevantes
> 2. **Conjunto de entregas** — verifica um grupo de entregas do build plan
> 3. **Completa** — verifica todo o projeto contra todos os blueprints
>
> Escolha o escopo (ou informe o nome da feature/entrega)."

Aguarde a resposta.

## Passo 2: Selecionar Verificacoes por Escopo

### Para Feature Especifica:
Carregue apenas os docs relevantes para a feature (mesmo mapeamento do `/codegen-feature`). Consulte `docs/shared/MAPPING.md` para rastreabilidade.

### Para Conjunto de Entregas:
1. Leia `docs/blueprint/11-build_plan.md` — identifique as entregas selecionadas
2. Carregue os docs relevantes para cada entrega

### Para Verificacao Completa:
Execute cada verificacao abaixo carregando os docs um par de cada vez (doc + codigo correspondente) para nao estourar o contexto.

## Passo 3: Identificar Clientes Frontend

Verifique quais clientes existem em `docs/frontend/` (web, mobile, desktop).
Execute V7 para cada cliente ativo.

## Passo 4: Executar Verificacoes

| Verificacao | Docs | Codigo | Checklist |
|-------------|------|--------|-----------|
| V1: Entidades vs Tipos | blueprint/04-domain + backend/03-domain | src/contracts/entities/ | Tipo existe? Atributos completos? Tipos corretos? Regras implementadas? Linguagem ubiqua? Value objects? |
| V2: Tabelas vs Schema | blueprint/05-data + backend/04-data-layer | Schema (prisma/drizzle) | Tabela existe? Campos/tipos? Constraints? Indices? FKs? Repository patterns? |
| V3: API vs Endpoints | backend/05-api-contracts + blueprint/07-flows | Rotas/controllers | Rota existe? Req/res types? Validacao (10)? Erros (09)? Middlewares (08)? |
| V4: Use Cases vs Testes | blueprint/08-use_cases + backend/14-tests | Arquivos de teste | Cenario principal coberto? Pre-condicoes? Excecoes testadas? Estrategia seguida? |
| V5: State Machines | blueprint/09-states + backend/03-domain | Services/entities | Estados no enum? Transicoes implementadas? Invalidas bloqueadas? Triggers corretos? |
| V6: Seguranca | blueprint/13-security + backend/08,11 | Middlewares, auth | Auth implementada? RBAC? Validacao input? Headers seguranca? |
| V7: Frontend (por cliente) | frontend/{{client}}/04-components + shared/03-design-system | Componentes | Existe? Props corretas? Estados locais? Design tokens? |
| V8: Cross-Layer | shared/event-mapping + error-ux-mapping | Handlers | Eventos consumidos? Erros com UX? Payloads consistentes? |

## Passo 5: Relatorio

Apresente: tabela resumo (V1-V8: Total/OK/Divergencias) + tabela de divergencias (tipo, doc vs codigo, acao sugerida) + score de aderencia (%).

Acoes sugeridas por divergencia:
- Codigo errado → `/codegen-feature`
- Doc desatualizado → `/blueprint-increment` ou `/frontend-increment`
- Ambiguo → pergunte ao dev

> "Score: {{N}}%. Corrigir: codigo → `/codegen-feature`, docs → `/blueprint-increment`. Continuar: `/codegen`."
