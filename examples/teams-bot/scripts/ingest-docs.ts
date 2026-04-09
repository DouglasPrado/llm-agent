/**
 * Ingest knowledge documents into the agent's RAG system.
 *
 * Usage:
 *   npx tsx scripts/ingest-docs.ts docs/cupons.md docs/planos.md
 *   npx tsx scripts/ingest-docs.ts docs/*.md
 *
 * Each file is ingested as a separate knowledge document.
 * The agent must be configured with knowledge: { enabled: true }.
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { Agent } from 'agentx-sdk';
import { config } from '../src/config.js';

async function main() {
  const files = process.argv.slice(2);

  if (files.length === 0) {
    console.error('Usage: npx tsx scripts/ingest-docs.ts <file1.md> [file2.md] ...');
    process.exit(1);
  }

  // Validate files exist
  for (const file of files) {
    const path = resolve(file);
    if (!existsSync(path)) {
      console.error(`File not found: ${path}`);
      process.exit(1);
    }
  }

  console.log('Initializing agent...');

  const agent = Agent.create({
    apiKey: config.agent.apiKey,
    model: config.agent.model,
    knowledge: { enabled: true },
    memory: { enabled: false },
    dbPath: './data/agent.db',
  });

  console.log(`Ingesting ${files.length} document(s)...\n`);

  for (const file of files) {
    const path = resolve(file);
    const content = readFileSync(path, 'utf-8');
    const name = basename(file);

    console.log(`  ${name} (${content.length} chars)`);

    await agent.ingestKnowledge({
      content,
      metadata: {
        source: name,
        filePath: path,
        ingestedAt: new Date().toISOString(),
      },
    });

    console.log(`  -> ingested`);
  }

  console.log('\nDone. Knowledge is ready for RAG queries.');
  await agent.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
