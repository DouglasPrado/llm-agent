import { Bot } from 'grammy';
import { config } from './config.js';
import { getAgent, destroyAgent } from './agent-factory.js';
import { handleStart, handleReset, handleUsage, handleMemory, handleMessage } from './handlers.js';

// Initialize agent eagerly to fail fast on bad config
getAgent();

// Create bot
const bot = new Bot(config.telegram.token);

// Commands
bot.command('start', handleStart);
bot.command('reset', handleReset);
bot.command('usage', handleUsage);
bot.command('memory', handleMemory);

// Main message handler
bot.on('message:text', handleMessage);

// Error handler
bot.catch((err) => {
  console.error('Bot error:', err.error);
});

// Graceful shutdown
async function shutdown() {
  console.log('\nShutting down...');
  bot.stop();
  await destroyAgent();
  console.log('Bye.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start
bot.start({
  onStart: (botInfo) => {
    console.log(`Bot @${botInfo.username} started`);
    console.log(`Model: ${config.agent.model}`);
    console.log(`Tavily: ${config.tavily.apiKey ? 'enabled' : 'disabled'}`);
    console.log(`Memory: enabled`);
    console.log('Waiting for messages...');
  },
});
