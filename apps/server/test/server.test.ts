import { mkdtemp, rm } from 'node:fs/promises';
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

describe('Hono Stateless API & Pull-Initiated Push', () => {
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

    // 1. Create session
    const createRes = await app.request('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; model: string };
    expect(created.model).toBe('claude-sonnet-5-5');

    // 2. Idle sync closes immediately with latestSeq=0
    const idleSyncRes = await app.request(`/api/sessions/${created.id}/sync?after=0`);
    expect(idleSyncRes.status).toBe(200);
    expect(await readNdjsonResponse(idleSyncRes)).toEqual([
      { type: 'done', status: 'idle', latestSeq: 0 },
    ]);

    // 3. Submit turn (202 Accepted)
    const turnRes = await app.request(`/api/sessions/${created.id}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Build feature X' }),
    });
    expect(turnRes.status).toBe(202);

    // Wait until thinking block (seq=2) lands in SQLite
    while (true) {
      const statusRes = await app.request(`/api/sessions/${created.id}/status`);
      const snap = (await statusRes.json()) as { status: string; latestSeq: number };
      if (snap.latestSeq >= 2) {
        expect(snap.status).toBe('running');
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }

    // 4. Two independent dumb frontends open /sync simultaneously at different offsets
    const tab1Promise = app
      .request(`/api/sessions/${created.id}/sync?after=0`)
      .then(readNdjsonResponse);
    const tab2Promise = app
      .request(`/api/sessions/${created.id}/sync?after=1`)
      .then(readNdjsonResponse);

    // Give both streams a tick to flush catch-up and attach to broadcast
    await new Promise((r) => setTimeout(r, 25));
    finishTurn();

    const [tab1Frames, tab2Frames] = await Promise.all([tab1Promise, tab2Promise]);

    const seqs = (frames: SyncFrame[]) =>
      frames
        .filter((f): f is Extract<SyncFrame, { type: 'block' }> => f.type === 'block')
        .map((f) => f.block.seq);

    // seq 1: user_message, seq 2: thinking, seq 3: assistant_message, seq 4: turn_result
    expect(seqs(tab1Frames)).toEqual([1, 2, 3, 4]);
    expect(seqs(tab2Frames)).toEqual([2, 3, 4]);
    expect(tab1Frames.at(-1)).toEqual({
      type: 'done',
      status: 'idle',
      latestSeq: 4,
    });
  });
});
