# AgentX SDK — Microsoft Teams Bot

A Microsoft Teams bot powered by [AgentX SDK](../../README.md) with streaming responses, persistent memory, web search, and MCP tool integration.

## Prerequisites

- Node.js 22+
- A Microsoft Bot registration ([Bot Framework Portal](https://dev.botframework.com/bots) or Azure Bot Service)
- An [OpenRouter](https://openrouter.ai) API key
- [ngrok](https://ngrok.com) or [dev tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/) for local development

## Setup

1. **Clone and install:**

```bash
cd examples/teams-bot
pnpm install
```

2. **Configure environment:**

```bash
cp .env.example .env
# Edit .env with your credentials
```

3. **Start a tunnel** (Teams requires HTTPS):

```bash
ngrok http 3978
# Copy the https URL, e.g. https://abc123.ngrok.io
```

4. **Configure Bot Framework endpoint:**

Go to [Bot Framework Portal](https://dev.botframework.com/bots) → your bot → Settings → Messaging endpoint:

```
https://abc123.ngrok.io/api/messages
```

5. **Start the bot:**

```bash
pnpm dev
```

6. **Test in Teams:**

Add the bot to Teams and send a message.

## Commands

| Command          | Description                |
| ---------------- | -------------------------- |
| `/start`         | Show help message          |
| `/reset`         | Clear conversation history |
| `/usage`         | Show token usage stats     |
| `/memory <text>` | Explicitly save a memory   |

## Features

- **Streaming responses** — Progressive message updates as the AI generates text
- **Persistent memory** — Remembers facts and preferences across conversations
- **Web search** — Tavily integration for real-time information (optional)
- **MCP tools** — Connect external tool servers via Model Context Protocol
- **Thread isolation** — Each Teams conversation has its own context

## Environment Variables

| Variable                  | Required | Description                               |
| ------------------------- | -------- | ----------------------------------------- |
| `MICROSOFT_APP_ID`        | Yes      | Bot Framework App ID                      |
| `MICROSOFT_APP_PASSWORD`  | Yes      | Bot Framework App Password                |
| `MICROSOFT_APP_TENANT_ID` | No       | Azure AD Tenant ID (empty = multi-tenant) |
| `PORT`                    | No       | Server port (default: 3978)               |
| `LLM_API_KEY`             | Yes      | LLM API key (any OpenAI-compatible provider) |
| `LLM_BASE_URL`            | No       | LLM base URL (default: OpenRouter)        |
| `AGENT_MODEL`             | No       | LLM model (default: claude-sonnet)        |
| `EMBEDDING_API_KEY`       | No       | Embedding API key (default: LLM_API_KEY)  |
| `EMBEDDING_BASE_URL`      | No       | Embedding base URL (default: LLM_BASE_URL)|
| `EMBEDDING_MODEL`         | No       | Embedding model (default: text-embedding-3-small) |
| `TAVILY_API_KEY`          | No       | Tavily API key for web search             |
| `MCP_ALBERT_URL`          | No       | MCP server URL                            |
| `MCP_ALBERT_TOKEN`        | No       | MCP server Bearer token                   |

## Architecture

```
Teams User → Bot Framework Service → POST /api/messages → Express Server
                                                              ↓
                                                        CloudAdapter
                                                              ↓
                                                      AgentXBot (handler)
                                                              ↓
                                                      Agent.stream() (AgentX SDK)
                                                              ↓
                                                    ┌─────────┴──────────┐
                                                    ↓                    ↓
                                              OpenRouter LLM      MCP Tools
                                                    ↓
                                            Streaming response
                                                    ↓
                                          Progressive message updates
                                                    ↓
                                              Teams User sees response
```

## Deployment

The bot needs a publicly accessible HTTPS endpoint. Deploy to any platform that supports Node.js:

- **Railway** / **Render** / **Fly.io** — Set environment variables and deploy
- **Azure App Service** — Native integration with Bot Framework
- **Docker** — Build and run with `pnpm build && node dist/bot.js`

Update the Bot Framework messaging endpoint to your production URL:

```
https://your-domain.com/api/messages
```

⏺ Pronto. O exemplo do Teams bot está criado com a mesma estrutura do Telegram:

examples/teams-bot/
├── .env.example # Template de credenciais
├── package.json # botbuilder + express + agentx-sdk
├── tsconfig.json # ES2022, ESM
├── README.md # Setup completo com ngrok
└── src/
├── bot.ts # Express server + CloudAdapter + graceful shutdown
├── config.ts # Env vars (APP_ID, APP_PASSWORD, PORT, etc.)
├── agent-factory.ts # Singleton Agent (system prompt adaptado pro Teams)
├── handlers.ts # TeamsActivityHandler com streaming progressivo
└── tools.ts # web_search + get_current_time (idêntico ao Telegram)

Para usar:

1. Copie .env.example para .env e preencha com as credenciais do Bot Framework Portal
2. pnpm install && pnpm dev
3. Inicie o ngrok: ngrok http 3978
4. Configure o endpoint no Bot Framework Portal: https://xxx.ngrok.io/api/messages
5. Teste no Teams

https://dev.teams.microsoft.com/tools/bots/0ffc18ca-2e5e-4c44-9a73-f42e5b5cf473/configure
