# Pure Agent — Telegram Bot

A Telegram bot powered by [Pure Agent](../../) with streaming responses, web search, and persistent memory.

## Features

- **Streaming responses** — Messages update in real-time as the AI generates text
- **Web search** — Tavily integration for up-to-date information
- **Memory** — The bot remembers facts across conversations
- **Thread isolation** — Each Telegram chat has its own conversation history
- **Cost control** — Token limits prevent runaway costs
- **Graceful error handling** — Errors are shown to the user without crashing

## Setup

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts
3. Copy the bot token

### 2. Get API Keys

- **OpenRouter**: [openrouter.ai/keys](https://openrouter.ai/keys)
- **Tavily** (optional): [tavily.com](https://tavily.com)

### 3. Configure

```bash
cp .env.example .env
# Edit .env with your tokens
```

### 4. Install & Run

```bash
npm install
npm run dev     # Development (auto-reload)
```

For production:

```bash
npm run build
npm run start:prod
```

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/reset` | Clear conversation history |
| `/usage` | Show token usage stats |
| `/memory <text>` | Explicitly save a memory |

## Adding Tools

Edit `src/tools.ts` to add new tools:

```typescript
tools.push({
  name: 'my_tool',
  description: 'What this tool does',
  parameters: z.object({ input: z.string() }),
  execute: async (args, signal) => {
    // Your implementation
    return 'result';
  },
});
```

## Architecture

```
src/
├── bot.ts            # Entry point — creates bot, registers handlers
├── config.ts         # Environment variables with validation
├── agent-factory.ts  # Agent singleton with configuration
├── handlers.ts       # Telegram message/command handlers
└── tools.ts          # Tool definitions (Tavily, datetime, etc.)
```

- **1 Agent instance** shared across all chats
- **threadId = chatId** isolates conversations
- **SQLite** persists memory in `data/agent.db`

## Deploy

### Railway / Fly.io

```bash
# Railway
railway init
railway up

# Fly.io
fly launch
fly deploy
```

Set environment variables in the platform dashboard.

### Docker

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ dist/
CMD ["node", "dist/bot.js"]
```

### VPS

```bash
# Install pm2
npm install -g pm2

# Start
npm run build
pm2 start dist/bot.js --name telegram-bot

# Auto-restart on reboot
pm2 startup
pm2 save
```
