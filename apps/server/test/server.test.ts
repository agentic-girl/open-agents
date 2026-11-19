import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type HarnessAdapter,
  type HarnessTurnContext,
  OpenAgentsEngine,
  type SyncFrame,
} from '@open-agents/core';
import { SqliteStoreAdapter } from '@open-agents/store-sqlite';
import { createServerApp } from '../src/app.js';

async function readNdjsonResponse(res: Response): Promise<SyncFrame[]> {
  const text = await res.text();
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SyncFrame);
}

describe('Hono Stateless API, Single-Port SPA & Zero-Restart Credentials', () => {
  let tempDir: string;
  let engine: OpenAgentsEngine;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'oa-server-test-'));
  });

  afterEach(async () => {
    await engine?.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('streams NDJSON via Pull-Initiated Push to multiple HTTP clients simultaneously', async () => {
    let finishTurn!: () => void;
    const gate = new Promise<void>((resolve) => {
      finishTurn = resolve;
    });

    const harness: HarnessAdapter = {
      id: 'claude',
      displayName: 'Claude Agent SDK',
      defaultModel: 'claude-sonnet-5-5',
      async runTurn(ctx: HarnessTurnContext) {
        await ctx.emit({ kind: 'thinking', thinking: 'Planning steps...' });
        await gate;
        await ctx.emit({ kind: 'assistant_message', text: 'Task finished.' });
      },
    };

    engine = new OpenAgentsEngine({
      store: new SqliteStoreAdapter({ dbPath: path.join(tempDir, 'server.db') }),
      harnesses: [harness],
      workspaceRoot: path.join(tempDir, 'workspaces'),
    });

    const app = createServerApp(engine);

    const createRes = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; model: string };
    expect(created.model).toBe('claude-sonnet-5-5');

    const idleSyncRes = await app.request(`/api/sessions/${created.id}/sync?after=0`);
    expect(idleSyncRes.status).toBe(200);
    expect(await readNdjsonResponse(idleSyncRes)).toEqual([
      { type: 'done', status: 'idle', latestSeq: 0 },
    ]);

    const turnRes = await app.request(`/api/sessions/${created.id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Build feature X' }),
    });
    expect(turnRes.status).toBe(202);

    while (true) {
      const statusRes = await app.request(`/api/sessions/${created.id}/status`);
      const snap = (await statusRes.json()) as { status: string; latestSeq: number };
      if (snap.latestSeq >= 2) {
        expect(snap.status).toBe('running');
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }

    const tab1Promise = app
      .request(`/api/sessions/${created.id}/sync?after=0`)
      .then(readNdjsonResponse);
    const tab2Promise = app
      .request(`/api/sessions/${created.id}/sync?after=1`)
      .then(readNdjsonResponse);

    await new Promise((r) => setTimeout(r, 25));
    finishTurn();

    const [tab1Frames, tab2Frames] = await Promise.all([tab1Promise, tab2Promise]);

    const seqs = (frames: SyncFrame[]) =>
      frames
        .filter((f): f is Extract<SyncFrame, { type: 'block' }> => f.type === 'block')
        .map((f) => f.block.seq);

    expect(seqs(tab1Frames)).toEqual([1, 2, 3, 4]);
    expect(seqs(tab2Frames)).toEqual([2, 3, 4]);
    expect(tab1Frames.at(-1)).toEqual({
      type: 'done',
      status: 'idle',
      latestSeq: 4,
    });
  });

  it('persists zero-restart runtime credentials with masked secret output and serves single-port SPA', async () => {
    const webDist = path.join(tempDir, 'web-dist');
    await mkdir(path.join(webDist, 'assets'), { recursive: true });
    await writeFile(path.join(webDist, 'index.html'), '<html>OpenAgents</html>');
    await writeFile(path.join(webDist, 'assets', 'app.js'), 'console.log("ok")');

    const harness: HarnessAdapter = {
      id: 'claude',
      displayName: 'Claude Agent SDK',
      defaultModel: 'claude-sonnet-5-5',
      async runTurn() {},
    };

    engine = new OpenAgentsEngine({
      store: new SqliteStoreAdapter({ dbPath: path.join(tempDir, 'settings.db') }),
      harnesses: [harness],
      workspaceRoot: path.join(tempDir, 'workspaces'),
    });

    const app = createServerApp(engine, { staticDir: webDist });

    // Save runtime API key via UI endpoint
    const saveRes = await app.request('/api/settings/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anthropicApiKey: 'sk-ant-api03-secretvalue9876' }),
    });
    expect(saveRes.status).toBe(200);
    const saved = (await saveRes.json()) as {
      configured: boolean;
      source: string;
      maskedKey: string;
    };
    expect(saved).toEqual({
      configured: true,
      source: 'store',
      maskedKey: 'sk-ant-...9876',
    });

    // Serves static assets and SPA fallback on the same port
    const assetRes = await app.request('/assets/app.js');
    expect(assetRes.status).toBe(200);
    expect(await assetRes.text()).toBe('console.log("ok")');

    const spaRes = await app.request('/?s=sess_123');
    expect(spaRes.status).toBe(200);
    expect(await spaRes.text()).toBe('<html>OpenAgents</html>');
  });
});
