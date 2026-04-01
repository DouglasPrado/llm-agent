import 'dotenv/config';

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing required env var: ${key}`);
    console.error(`Copy .env.example to .env and fill in the values.`);
    process.exit(1);
  }
  return value;
}

export const config = {
  telegram: {
    token: required('TELEGRAM_BOT_TOKEN'),
    adminUserId: process.env.ADMIN_USER_ID ? Number(process.env.ADMIN_USER_ID) : undefined,
  },
  agent: {
    apiKey: required('OPENROUTER_API_KEY'),
    model: process.env.AGENT_MODEL ?? 'anthropic/claude-sonnet-4-20250514',
  },
  tavily: {
    apiKey: process.env.TAVILY_API_KEY,
  },
};
