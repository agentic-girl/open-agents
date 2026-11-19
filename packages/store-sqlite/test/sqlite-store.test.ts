import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteStoreAdapter } from '../src/index.js';

describe('SqliteStoreAdapter', () => {
  let tempDir: string;
  let store: SqliteStoreAdapter;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'oa-sqlite-test-'));
    store = new SqliteStoreAdapter({
      dbPath: path.join(tempDir, 'test.db'),
    });
  });

  afterEach(async () => {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('atomically assigns strictly monotonic seq watermarks per session', async () => {
    const s1 = await store.createSession({
      harnessId: 'claude',
      model: 'claude-sonnet-5-5',
      cwd: tempDir,
      title: 'Test Session',
    });

    const b1 = await store.appendBlock(s1.id, 'turn_1', {
      kind: 'user_message',
      text: 'Hello',
    });
    const b2 = await store.appendBlock(s1.id, 'turn_1', {
      kind: 'assistant_message',
      text: 'Hi there!',
    });
    const b3 = await store.appendBlock(s1.id, 'turn_1', {
      kind: 'turn_result',
      outcome: 'completed',
      durationMs: 420,
      costUsd: 0.004,
    });

    expect([b1.seq, b2.seq, b3.seq]).toEqual([1, 2, 3]);

    const status = await store.getSessionStatus(s1.id);
    expect(status?.latestSeq).toBe(3);

    const delta = await store.getBlocksAfter(s1.id, 1);
    expect(delta.map((b) => b.seq)).toEqual([2, 3]);
    expect(delta[0]?.payload).toEqual({
      kind: 'assistant_message',
      text: 'Hi there!',
    });
  });

  it('recovers orphaned running sessions to idle on database open', async () => {
    const dbPath = path.join(tempDir, 'crash-recovery.db');
    const first = new SqliteStoreAdapter({ dbPath });
    const session = await first.createSession({
      harnessId: 'claude',
      model: 'claude-sonnet-5-5',
      cwd: tempDir,
    });
    await first.updateSession(session.id, { status: 'running' });
    first.close();

    const reopened = new SqliteStoreAdapter({ dbPath });
    const recovered = await reopened.getSession(session.id);
    expect(recovered?.status).toBe('idle');
    reopened.close();
  });
});
