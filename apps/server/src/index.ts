#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import dotenv from 'dotenv';
import { OpenAgentsEngine } from '@open-agents/core';
import { ClaudeHarnessAdapter, DEFAULT_CLAUDE_MODEL } from '@open-agents/harness-claude';
import { SqliteStoreAdapter } from '@open-agents/store-sqlite';
import { ANTHROPIC_KEY_SETTING, createServerApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// Load .env from repo root and current working directory
dotenv.config({ path: path.join(repoRoot, '.env') });
dotenv.config();

const defaultWebDist = path.join(repoRoot, 'apps', 'web', 'dist');
const staticDir =
  process.env.WEB_DIST_DIR ??
  (existsSync(path.join(defaultWebDist, 'index.html')) ? defaultWebDist : undefined);

// Default to single-port 3000 in standalone/Docker mode; dev script passes PORT=3001 for Vite HMR
const port = Number(process.env.PORT ?? (staticDir ? 3000 : 3001));
const hostname = process.env.HOST ?? '0.0.0.0';
const dbPath =
  process.env.DATABASE_PATH ?? path.join(repoRoot, 'data', 'open-agents.db');
const workspaceRoot =
  process.env.WORKSPACE_ROOT ?? path.join(repoRoot, 'workspaces');
const claudeModel = process.env.CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL;

const store = new SqliteStoreAdapter({ dbPath });
const claudeHarness = new ClaudeHarnessAdapter({
  defaultModel: claudeModel,
  resolveApiKey: async () => {
    const stored = await store.getSetting(ANTHROPIC_KEY_SETTING);
    return stored?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  },
});

const engine = new OpenAgentsEngine({
  store,
  harnesses: [claudeHarness],
  workspaceRoot,
});

const app = createServerApp(engine, { staticDir });

const server = serve(
  {
    fetch: app.fetch,
    port,
    hostname,
  },
  (info) => {
    const displayHost = info.address === '0.0.0.0' ? 'localhost' : info.address;
    console.log(`\n  OpenAgents ready at http://${displayHost}:${info.port}`);
    console.log(
      `  Harness: ${claudeHarness.id} (${claudeHarness.defaultModel}) | Store: SQLite (${dbPath})`,
    );
    if (staticDir && port !== 3001) {
      console.log(`  Serving turnkey Web UI + API on single port :${info.port}\n`);
    }
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
