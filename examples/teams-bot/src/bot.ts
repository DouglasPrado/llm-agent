import express from 'express';
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
} from 'botbuilder';
import { config } from './config.js';
import { destroyAll, validateMCP } from './agent-factory.js';
import { AgentXBot } from './handlers.js';

// Bot Framework authentication
const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
  MicrosoftAppId: config.teams.appId,
  MicrosoftAppPassword: config.teams.appPassword,
  MicrosoftAppType: 'SingleTenant',
  MicrosoftAppTenantId: config.teams.tenantId || undefined,
});

// Create adapter with error handler
const adapter = new CloudAdapter(botFrameworkAuth);

adapter.onTurnError = async (context, error) => {
  console.error('[onTurnError]', error);
  try {
    await context.sendActivity('The bot encountered an error. Please try again.');
  } catch { /* ignore send errors */ }
};

// Create bot
const bot = new AgentXBot();

// Create Express server
const app = express();
app.use(express.json());

// Bot Framework messaging endpoint
app.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, (context) => bot.run(context));
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Start server
const server = app.listen(config.server.port, async () => {
  console.log(`Teams bot listening on port ${config.server.port}`);
  console.log(`Endpoint: POST http://localhost:${config.server.port}/api/messages`);
  console.log(`Model: ${config.agent.model}`);
  console.log(`Tavily: ${config.tavily.apiKey ? 'enabled' : 'disabled'}`);

  const mcp = await validateMCP();
  console.log(`MCP Albert: ${mcp.status}${mcp.reason ? ` (${mcp.reason})` : ''}`);

  console.log(`Memory: enabled`);
  console.log('Waiting for messages...');
});

// Graceful shutdown
async function shutdown() {
  console.log('\nShutting down...');
  server.close();
  await destroyAll();
  console.log('Bye.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
