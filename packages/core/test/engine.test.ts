import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type HarnessAdapter,
  type HarnessTurnContext,
  MemoryStoreAdapter,
  OpenAgentsEngine,
  SessionBusyError,
  type SyncFrame,
} from '../src/index.js';

async function collectSync(gen: AsyncGenerator<SyncFrame>): Promise<SyncFrame[]> {
  const frames: SyncFrame[] = [];
  for await (const frame of gen) {
    frames.push(frame);
  }
  return frames;
}

describe('OpenAgentsEngine & Pull-Initiated Push', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await mkdtemp(path.join(tmpdir(), 'oa-core-test-'));
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
  });

  it('closes streamSync immediately when session is idle and delivers exact catch-up delta', async () => {
    const harness: HarnessAdapter = {
      id: 'stub',
      displayName: 'Stub',
      defaultModel: 'stub-1',
      async runTurn(ctx: HarnessTurnContext) {
        await ctx.emit({ kind: 'thinking', thinking: 'Checking files...' });
        await ctx.emit({ kind: 'assistant_message', text: 'All clear.' });
      },
    };

    const engine = new OpenAgentsEngine({
      store: new MemoryStoreAdapter(),
      harnesses: [harness],
      workspaceRoot: workspaceDir,
    });

    const session = await engine.createSession();
    await engine.submitTurn(session.id, 'Check status');

    // Wait for turn to finish
    while ((await engine.getSessionStatus(session.id)).status === 'running') {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Fresh tab (?after=0) receives all 4 blocks + done immediately
    const fullFrames = await collectSync(engine.streamSync(session.id, 0));
    const blockSeqs = fullFrames
      .filter((f): f is Extract<SyncFrame, { type: 'block' }> => f.type === 'block')
      .map((f) => f.block.seq);
    expect(blockSeqs).toEqual([1, 2, 3, 4]);
    expect(fullFrames.at(-1)).toEqual({
      type: 'done',
      status: 'idle',
      latestSeq: 4,
    });

    // Reconnecting tab (?after=2) receives only blocks 3 & 4 + done immediately
    const deltaFrames = await collectSync(engine.streamSync(session.id, 2));
    const deltaSeqs = deltaFrames
      .filter((f): f is Extract<SyncFrame, { type: 'block' }> => f.type === 'block')
      .map((f) => f.block.seq);
    expect(deltaSeqs).toEqual([3, 4]);

    await engine.close();
  });

  it('broadcasts live blocks simultaneously to multiple dumb receivers and survives mid-run reconnects', async () => {
    let releaseStep2!: () => void;
    const step2Gate = new Promise<void>((resolve) => {
      releaseStep2 = resolve;
    });

    const harness: HarnessAdapter = {
      id: 'slow-stub',
      displayName: 'Slow Stub',
      defaultModel: 'stub-1',
      async runTurn(ctx: HarnessTurnContext) {
        await ctx.emit({
          kind: 'tool_use',
          toolUseId: 'call_1',
          toolName: 'Bash',
          input: { command: 'ls' },
        });
        await step2Gate;
        await ctx.emit({
          kind: 'tool_result',
          toolUseId: 'call_1',
          toolName: 'Bash',
          output: 'README.md',
          isError: false,
        });
        await ctx.emit({
          kind: 'assistant_message',
          text: 'Found README.md.',
        });
      },
    };

    const engine = new OpenAgentsEngine({
      store: new MemoryStoreAdapter(),
      harnesses: [harness],
      workspaceRoot: workspaceDir,
    });

    const session = await engine.createSession();
    await engine.submitTurn(session.id, 'List files');

    // Wait until seq 2 (tool_use) is persisted while turn is still paused on step2Gate
    while ((await engine.getSessionStatus(session.id)).latestSeq < 2) {
      await new Promise((r) => setTimeout(r, 5));
    }

    // Receiver 1 tunes in from seq=0 while run is mid-flight
    const receiver1Promise = collectSync(engine.streamSync(session.id, 0));

    // Receiver 2 tunes in from seq=1 while run is mid-flight
    const receiver2Promise = collectSync(engine.streamSync(session.id, 1));

    // Receiver 3 tunes in from seq=0, reads 2 frames, then simulates a Wi-Fi drop!
    const abortReceiver3 = new AbortController();
    const receiver3FirstLeg: SyncFrame[] = [];
    const receiver3Leg1Promise = (async () => {
      for await (const frame of engine.streamSync(
        session.id,
        0,
        abortReceiver3.signal,
      )) {
        receiver3FirstLeg.push(frame);
        if (receiver3FirstLeg.length === 2) {
          abortReceiver3.abort();
        }
      }
    })();

    await receiver3Leg1Promise;
    expect(receiver3FirstLeg).toHaveLength(2);
    const lastSeenByR3 =
      receiver3FirstLeg[1]?.type === 'block' ? receiver3FirstLeg[1].block.seq : 0;
    expect(lastSeenByR3).toBe(2);

    // Receiver 3 reconnects with afterSeq=2 BEFORE step2Gate releases
    const receiver3Leg2Promise = collectSync(
      engine.streamSync(session.id, lastSeenByR3),
    );

    // Release remaining agent steps
    releaseStep2();

    const [r1, r2, r3Leg2] = await Promise.all([
      receiver1Promise,
      receiver2Promise,
      receiver3Leg2Promise,
    ]);

    const seqsOf = (frames: SyncFrame[]) =>
      frames
        .filter((f): f is Extract<SyncFrame, { type: 'block' }> => f.type === 'block')
        .map((f) => f.block.seq);

    expect(seqsOf(r1)).toEqual([1, 2, 3, 4, 5]);
    expect(seqsOf(r2)).toEqual([2, 3, 4, 5]);
    expect(seqsOf(r3Leg2)).toEqual([3, 4, 5]);
    expect(r1.at(-1)).toEqual({ type: 'done', status: 'idle', latestSeq: 5 });

    await engine.close();
  });

  it('persists harnessSessionId across turns and rejects concurrent turns on the same session', async () => {
    const seenResumeIds: Array<string | null> = [];
    let unblockTurn1!: () => void;
    const gate = new Promise<void>((r) => {
      unblockTurn1 = r;
    });

    const harness: HarnessAdapter = {
      id: 'session-stub',
      displayName: 'Session Stub',
      defaultModel: 'stub-1',
      async runTurn(ctx: HarnessTurnContext) {
        seenResumeIds.push(ctx.harnessSessionId);
        await ctx.onHarnessSessionId('native_sdk_session_abc');
        if (seenResumeIds.length === 1) {
          await gate;
        }
        await ctx.emit({ kind: 'assistant_message', text: 'Done turn' });
      },
    };

    const engine = new OpenAgentsEngine({
      store: new MemoryStoreAdapter(),
      harnesses: [harness],
      workspaceRoot: workspaceDir,
    });

    const session = await engine.createSession();
    await engine.submitTurn(session.id, 'First message');

    // Submitting while already running throws SessionBusyError
    await expect(engine.submitTurn(session.id, 'Overlap')).rejects.toBeInstanceOf(
      SessionBusyError,
    );

    unblockTurn1();
    await collectSync(engine.streamSync(session.id, 0));

    // Second turn receives native_sdk_session_abc!
    await engine.submitTurn(session.id, 'Second message');
    await collectSync(engine.streamSync(session.id, 0));

    expect(seenResumeIds).toEqual([null, 'native_sdk_session_abc']);

    const updated = await engine.getSession(session.id);
    expect(updated.title).toBe('First message');
    expect(updated.harnessSessionId).toBe('native_sdk_session_abc');

    await engine.close();
  });
});
