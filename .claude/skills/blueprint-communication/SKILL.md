---
name: blueprint-communication
description: Preenche 17-communication.md — templates de email, SMS, WhatsApp e convencoes.
---

# Blueprint — Comunicação

Você vai preencher a seção de Comunicação do blueprint. Mensagens enviadas ao usuário (email, SMS, WhatsApp) são extensões do produto — projete-as como features, com templates, variáveis, triggers e regras claras.

## Leitura de Contexto

1. Leia `docs/prd.md` — fonte primária
2. Leia `docs/blueprint/17-communication.md` — template a preencher
3. Leia `docs/blueprint/07-critical_flows.md` — para identificar fluxos que geram comunicação (cadastro, reset senha, checkout, etc.)
4. Leia `docs/blueprint/08-use_cases.md` — para mapear eventos que disparam mensagens
5. Leia `docs/blueprint/04-domain-model.md` — para identificar entidades e variáveis disponíveis
6. Leia `docs/blueprint/13-security.md` — para alinhar autenticação (2FA, tokens) com templates de verificação

## Análise de Lacunas

A partir do PRD e dos fluxos/use cases, identifique o que está disponível para cada subseção:

- **Estratégia de Comunicação**: Canais utilizados, prioridade, opt-in/opt-out, provedores
- **Templates de Email**: Emails transacionais (boas-vindas, confirmação, reset) e marketing/lifecycle
- **Templates de SMS**: Se aplicável — verificação, alertas, notificações (marque "Não aplicável" se o PRD não mencionar SMS)
- **Templates de WhatsApp**: Se aplicável — templates aprovados pela Meta, categorias (marque "Não aplicável" se o PRD não mencionar WhatsApp)
- **Variáveis e Personalização**: Dados dinâmicos disponíveis nos templates
- **Regras de Envio**: Triggers, condições, cooldowns, prioridade entre canais, rate limits
- **Convenções de Escrita por Canal**: Tom de voz, limites de caracteres, regras de formatação

Se houver lacunas críticas que NÃO podem ser inferidas do PRD, faça até 3 perguntas pontuais ao usuário. Em particular:

1. Se o PRD não menciona SMS/WhatsApp, pergunte se esses canais serão usados
2. Se não há informação sobre provedores (SendGrid, Twilio, etc.), pergunte qual stack de envio
3. Se não há fluxo de onboarding detalhado, pergunte sobre emails de lifecycle

> **Versoes:** Para tecnologias com versao, consulte via `mcp__context7__resolve-library-id` → `mcp__context7__query-docs`.

## Geração

> **Modo de escrita:**
> - Se o documento contém apenas `{{placeholders}}` (primeira vez): use Write para preencher tudo.
> - Se o documento já tem conteúdo real (reexecução): use **Edit** para atualizar APENAS o que mudou. Preserve conteúdo existente. Insira novo conteúdo antes dos marcadores `<!-- APPEND:... -->`.
> - Para adicionar templates de uma feature específica sem reescrever, prefira `/blueprint-increment`.

Preencha `docs/blueprint/17-communication.md` substituindo TODOS os `{{placeholders}}`. Mantenha a estrutura. Use:
- Informações explícitas do PRD
- Fluxos de `07-critical_flows.md` para mapear eventos que geram comunicação
- Use cases de `08-use_cases.md` para identificar todos os pontos de envio
- Modelo de domínio de `04-domain-model.md` para definir variáveis disponíveis
- Security de `13-security.md` para alinhar templates de verificação/2FA
- Respostas do usuário (se houve perguntas)
- Inferências lógicas quando seguro (marque com `<!-- inferido do PRD -->`)

**Regras específicas:**
- Para cada email transacional, gere assunto, preheader, corpo, CTA e fallback texto
- Para SMS, respeite o limite de 160 caracteres por mensagem
- Para WhatsApp, use o formato de template aprovado pela Meta (header, body, footer, buttons)
- Se SMS ou WhatsApp não se aplicam, marque `Status: Não aplicável` e remova os templates de exemplo, mantendo apenas o template genérico

### Checklist de Cobertura

Antes de finalizar, verifique:

- [ ] Todo fluxo crítico de `07-critical_flows.md` que envolve comunicação tem um template correspondente
- [ ] Emails transacionais cobrem no mínimo: boas-vindas, confirmação de email, reset de senha
- [ ] Cada template de email tem assunto, preheader, corpo, CTA e fallback texto
- [ ] Variáveis utilizadas nos templates estão documentadas na tabela de variáveis
- [ ] Triggers estão mapeados no Mapa de Triggers com condições e cooldowns
- [ ] Provedores de envio estão definidos na estratégia
- [ ] SMS e WhatsApp estão marcados como "Não aplicável" se não forem usados
- [ ] Rate limits estão definidos para cada canal
- [ ] Convenções de escrita por canal estão preenchidas

## Revisão

Apresente o documento preenchido ao usuário. Aplique ajustes solicitados. Salve o arquivo final.

## Próxima Etapa

> "Comunicação documentada. O blueprint técnico está completo! Rode `/blueprint` para revisar a cobertura geral, ou `/blueprint-increment` para adicionar templates de novas features."
