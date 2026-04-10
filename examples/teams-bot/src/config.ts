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
  database: {
    url: process.env.DATABASE_URL,
  },
  teams: {
    appId: required('MICROSOFT_APP_ID'),
    appPassword: required('MICROSOFT_APP_PASSWORD'),
    tenantId: process.env.MICROSOFT_APP_TENANT_ID ?? '',
  },
  server: {
    port: Number(process.env.PORT ?? 3978),
  },
  agent: {
    apiKey: required('OPENROUTER_API_KEY'),
    model: process.env.AGENT_MODEL ?? 'anthropic/claude-sonnet-4-20250514',
  },
  tavily: {
    apiKey: process.env.TAVILY_API_KEY,
  },
  mcp: {
    albert: {
      url: process.env.MCP_ALBERT_URL,
      headers: process.env.MCP_ALBERT_TOKEN
        ? { 'Authorization': `Bearer ${process.env.MCP_ALBERT_TOKEN}` }
        : undefined,
    },
  },
};
