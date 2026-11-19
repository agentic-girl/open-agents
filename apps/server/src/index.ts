import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import dotenv from 'dotenv';
import { OpenAgentsEngine } from '@open-agents/core';
import { ClaudeHarnessAdapter, DEFAULT_CLAUDE_MODEL } from '@open-agents/harness-claude';
import { SqliteStoreAdapter } from '@open-agents/store-sqlite';
import { createServerApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// Load .env from repo root first, then allow local overrides
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config();

const port = Number(process.env.PORT ?? 3001);
const hostname = process.env.HOST ?? '0.0.0.0';
const dbPath =
  process.env.DATABASE_PATH ?? path.join(repoRoot, 'data', 'open-agents.db');
const workspaceRoot =
  process.env.WORKSPACE_ROOT ?? path.join(repoRoot, 'workspaces');
const claudeModel = process.env.CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL;

const store = new SqliteStoreAdapter({ dbPath });
const claudeHarness = new ClaudeHarnessAdapter({
  defaultModel: claudeModel,
});

const engine = new OpenAgentsEngine({
  store,
  harnesses: [claudeHarness],
  workspaceRoot,
});

const app = createServerApp(engine);

const server = serve(
  {
    fetch: app.fetch,
    port,
    hostname,
  },
  (info) => {
    console.log(
      `[open-agents] Hono API listening on http://${info.address}:${info.port}`,
    );
    console.log(
      `[open-agents] Harness: ${claudeHarness.id} (${claudeHarness.defaultModel}) | Store: SQLite (${dbPath})`,
    );
  },
);

async function shutdown(signal: string) {
  console.log(`\n[open-agents] Received ${signal}, shutting down cleanly...`);
  server.close();
  await engine.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
