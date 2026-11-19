import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { InProcessTurnDispatcher } from './adapters/in-process-dispatcher.js';
import { InMemoryBroadcaster } from './adapters/memory-broadcaster.js';
import { HarnessNotFoundError, SessionBusyError, SessionNotFoundError } from './errors.js';
import type {
  BroadcasterAdapter,
  BroadcastFrame,
  HarnessAdapter,
  StoreAdapter,
  TurnDispatcherAdapter,
  TurnJob,
} from './ports.js';
import type {
  BlockPayload,
  HarnessMetadata,
  Session,
  SessionBlock,
  SessionStatus,
  SessionStatusSnapshot,
  SyncFrame,
} from './types.js';

export interface OpenAgentsEngineConfig {
  store: StoreAdapter;
  harnesses: HarnessAdapter[];
  broadcaster?: BroadcasterAdapter;
  dispatcher?: TurnDispatcherAdapter;
  workspaceRoot?: string;
}

export interface CreateEngineSessionOptions {
  id?: string;
  title?: string;
  harnessId?: string;
  model?: string;
  cwd?: string;
}

export interface SubmitTurnOptions {
  systemPrompt?: string;
}

export interface SubmitTurnResult {
  turnId: string;
  userBlock: SessionBlock;
}

export class OpenAgentsEngine {
  readonly store: StoreAdapter;
  readonly broadcaster: BroadcasterAdapter;
  readonly dispatcher: TurnDispatcherAdapter;
  readonly workspaceRoot: string;
  private readonly harnesses = new Map<string, HarnessAdapter>();

  constructor(config: OpenAgentsEngineConfig) {
    if (config.harnesses.length === 0) {
      throw new Error('OpenAgentsEngine requires at least one HarnessAdapter.');
    }

    this.store = config.store;
    this.broadcaster = config.broadcaster ?? new InMemoryBroadcaster();
    this.dispatcher = config.dispatcher ?? new InProcessTurnDispatcher();
    this.workspaceRoot = path.resolve(config.workspaceRoot ?? './workspaces');

    for (const harness of config.harnesses) {
      this.harnesses.set(harness.id, harness);
    }

    this.dispatcher.registerHandler((job, signal) => this.executeTurnJob(job, signal));
  }

  registerHarness(harness: HarnessAdapter): void {
    this.harnesses.set(harness.id, harness);
  }

  listHarnesses(): HarnessMetadata[] {
    return Array.from(this.harnesses.values()).map((h) => ({
      id: h.id,
      displayName: h.displayName,
      defaultModel: h.defaultModel,
      supportedModels: h.supportedModels ?? [h.defaultModel],
    }));
  }

  private resolveHarness(harnessId?: string): HarnessAdapter {
    if (!harnessId) {
      const first = this.harnesses.values().next().value;
      if (!first) {
        throw new HarnessNotFoundError('default');
      }
      return first;
    }
    const found = this.harnesses.get(harnessId);
    if (!found) {
      throw new HarnessNotFoundError(harnessId);
    }
    return found;
  }

  async createSession(options: CreateEngineSessionOptions = {}): Promise<Session> {
    const harness = this.resolveHarness(options.harnessId);
    const id = options.id ?? `sess_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const cwd = options.cwd
      ? path.resolve(options.cwd)
      : path.join(this.workspaceRoot, id);

    await mkdir(cwd, { recursive: true });

    return this.store.createSession({
      id,
      title: options.title,
      harnessId: harness.id,
      model: options.model ?? harness.defaultModel,
      cwd,
    });
  }

  async getSession(sessionId: string): Promise<Session> {
    const session = await this.store.getSession(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
    return session;
  }

  async getSessionStatus(sessionId: string): Promise<SessionStatusSnapshot> {
    const snapshot = await this.store.getSessionStatus(sessionId);
    if (!snapshot) {
      throw new SessionNotFoundError(sessionId);
    }
    return snapshot;
  }

  async listSessions(limit = 100): Promise<Session[]> {
    return this.store.listSessions(limit);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    await this.dispatcher.abort(sessionId);
    return this.store.deleteSession(sessionId);
  }

  async getBlocksAfter(
    sessionId: string,
    afterSeq = 0,
    limit = 500,
  ): Promise<SessionBlock[]> {
    const exists = await this.store.getSessionStatus(sessionId);
    if (!exists) {
      throw new SessionNotFoundError(sessionId);
    }
    return this.store.getBlocksAfter(sessionId, afterSeq, limit);
  }

  async submitTurn(
    sessionId: string,
    rawPrompt: string,
    options: SubmitTurnOptions = {},
  ): Promise<SubmitTurnResult> {
    const prompt = rawPrompt.trim();
    if (!prompt) {
      throw new Error('Prompt cannot be empty.');
    }

    const session = await this.store.getSession(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
    if (session.status === 'running') {
      throw new SessionBusyError(sessionId);
    }

    // Verify the session's harness is registered before starting
    this.resolveHarness(session.harnessId);

    await mkdir(session.cwd, { recursive: true });

    const shouldAutoTitle = session.latestSeq === 0 && session.title === 'New Chat';
    const derivedTitle = shouldAutoTitle ? deriveSessionTitle(prompt) : undefined;

    await this.store.updateSession(sessionId, {
      status: 'running',
      ...(derivedTitle ? { title: derivedTitle } : {}),
    });

    const turnId = `turn_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const userBlock = await this.store.appendBlock(sessionId, turnId, {
      kind: 'user_message',
      text: prompt,
    });

    await this.broadcaster.publish(sessionId, { type: 'block', block: userBlock });
    await this.broadcaster.publish(sessionId, {
      type: 'status',
      sessionId,
      status: 'running',
      latestSeq: userBlock.seq,
    });

    await this.dispatcher.enqueue({
      sessionId,
      turnId,
      prompt,
      systemPrompt: options.systemPrompt,
    });

    return { turnId, userBlock };
  }

  async abortTurn(sessionId: string): Promise<boolean> {
    const exists = await this.store.getSessionStatus(sessionId);
    if (!exists) {
      throw new SessionNotFoundError(sessionId);
    }
    return this.dispatcher.abort(sessionId);
  }

  /**
   * Race-free Pull-Initiated Push generator:
   * 1. Subscribes to live broadcasts BEFORE querying durable storage.
   * 2. Flushes all persisted blocks with `seq > afterSeq`.
   * 3. If the session is idle/error, yields `{ type: 'done' }` and exits immediately.
   * 4. If the session is running, yields live broadcast blocks until the turn finishes, then exits.
   */
  async *streamSync(
    sessionId: string,
    afterSeq = 0,
    signal?: AbortSignal,
  ): AsyncGenerator<SyncFrame, void, void> {
    const initialStatus = await this.store.getSessionStatus(sessionId);
    if (!initialStatus) {
      throw new SessionNotFoundError(sessionId);
    }

    const liveQueue: BroadcastFrame[] = [];
    let wakeUp: (() => void) | null = null;
    let closed = false;

    const notify = () => {
      if (wakeUp) {
        const resolve = wakeUp;
        wakeUp = null;
        resolve();
      }
    };

    const unsubscribe = this.broadcaster.subscribe(sessionId, (frame) => {
      if (closed) return;
      liveQueue.push(frame);
      notify();
    });

    const onAbort = () => {
      closed = true;
      notify();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      let highWaterMark = Math.max(0, afterSeq);

      // Phase 1 (Pull): Catch up all persisted blocks after `afterSeq`
      while (!signal?.aborted) {
        const batch = await this.store.getBlocksAfter(sessionId, highWaterMark, 500);
        if (batch.length === 0) break;

        for (const block of batch) {
          if (signal?.aborted) return;
          if (block.seq > highWaterMark) {
            highWaterMark = block.seq;
            yield { type: 'block', block };
          }
        }

        if (batch.length < 500) break;
      }

      if (signal?.aborted) return;

      // Drain any frames that arrived during the catch-up query
      while (liveQueue.length > 0) {
        const frame = liveQueue.shift()!;
        if (frame.type === 'block' && frame.block.seq > highWaterMark) {
          highWaterMark = frame.block.seq;
          yield { type: 'block', block: frame.block };
        } else if (frame.type === 'status' && frame.status !== 'running') {
          highWaterMark = yield* this.flushTailBlocks(sessionId, highWaterMark);
          yield {
            type: 'done',
            status: frame.status,
            latestSeq: Math.max(highWaterMark, frame.latestSeq),
          };
          return;
        }
      }

      const statusSnapshot = await this.store.getSessionStatus(sessionId);
      if (!statusSnapshot) return;

      // If session is NOT running, finish immediately (zero idle open connections)
      if (statusSnapshot.status !== 'running') {
        if (statusSnapshot.latestSeq > highWaterMark) {
          highWaterMark = yield* this.flushTailBlocks(sessionId, highWaterMark);
        }
        yield {
          type: 'done',
          status: statusSnapshot.status,
          latestSeq: Math.max(highWaterMark, statusSnapshot.latestSeq),
        };
        return;
      }

      // Phase 2 (Push): Session is running — stream live broadcast frames until turn ends
      while (!closed && !signal?.aborted) {
        if (liveQueue.length === 0) {
          await new Promise<void>((resolve) => {
            wakeUp = resolve;
          });
          continue;
        }

        const frame = liveQueue.shift()!;
        if (frame.type === 'block') {
          if (frame.block.seq > highWaterMark) {
            highWaterMark = frame.block.seq;
            yield { type: 'block', block: frame.block };
          }
        } else if (frame.type === 'status' && frame.status !== 'running') {
          if (frame.latestSeq > highWaterMark) {
            highWaterMark = yield* this.flushTailBlocks(sessionId, highWaterMark);
          }
          yield {
            type: 'done',
            status: frame.status,
            latestSeq: Math.max(highWaterMark, frame.latestSeq),
          };
          return;
        }
      }
    } finally {
      closed = true;
      signal?.removeEventListener('abort', onAbort);
      unsubscribe();
    }
  }

  private async *flushTailBlocks(
    sessionId: string,
    currentHighWaterMark: number,
  ): AsyncGenerator<SyncFrame, number, void> {
    let hwm = currentHighWaterMark;
    const tail = await this.store.getBlocksAfter(sessionId, hwm, 500);
    for (const block of tail) {
      if (block.seq > hwm) {
        hwm = block.seq;
        yield { type: 'block', block };
      }
    }
    return hwm;
  }

  private async executeTurnJob(job: TurnJob, signal: AbortSignal): Promise<void> {
    const startTime = Date.now();
    let emittedTurnResult = false;
    let finalStatus: SessionStatus = 'idle';

    const emitBlock = async (payload: BlockPayload): Promise<SessionBlock> => {
      if (payload.kind === 'turn_result') {
        emittedTurnResult = true;
        finalStatus = payload.outcome === 'error' ? 'error' : 'idle';
      }
      const block = await this.store.appendBlock(job.sessionId, job.turnId, payload);
      await this.broadcaster.publish(job.sessionId, { type: 'block', block });
      return block;
    };

    try {
      const session = await this.store.getSession(job.sessionId);
      if (!session) return;

      const harness = this.resolveHarness(session.harnessId);

      await harness.runTurn({
        sessionId: session.id,
        turnId: job.turnId,
        prompt: job.prompt,
        cwd: session.cwd,
        model: session.model,
        systemPrompt: job.systemPrompt,
        harnessSessionId: session.harnessSessionId,
        signal,
        onHarnessSessionId: async (nativeSessionId: string) => {
          if (nativeSessionId && nativeSessionId !== session.harnessSessionId) {
            session.harnessSessionId = nativeSessionId;
            await this.store.updateSession(session.id, {
              harnessSessionId: nativeSessionId,
            });
          }
        },
        emit: emitBlock,
      });

      if (!emittedTurnResult) {
        await emitBlock({
          kind: 'turn_result',
          outcome: signal.aborted ? 'aborted' : 'completed',
          durationMs: Date.now() - startTime,
        });
      }
    } catch (err: unknown) {
      const isAbort =
        signal.aborted ||
        (err instanceof Error &&
          (err.name === 'AbortError' || /abort/i.test(err.message)));

      if (!emittedTurnResult) {
        if (isAbort) {
          finalStatus = 'idle';
          await emitBlock({
            kind: 'turn_result',
            outcome: 'aborted',
            durationMs: Date.now() - startTime,
          });
        } else {
          finalStatus = 'error';
          const message = err instanceof Error ? err.message : String(err);
          await emitBlock({
            kind: 'turn_result',
            outcome: 'error',
            durationMs: Date.now() - startTime,
            errorMessage: message,
          });
        }
      }
    } finally {
      try {
        const updated = await this.store.updateSession(job.sessionId, {
          status: finalStatus,
        });
        await this.broadcaster.publish(job.sessionId, {
          type: 'status',
          sessionId: job.sessionId,
          status: updated.status,
          latestSeq: updated.latestSeq,
        });
      } catch {
        // Session may have been deleted while running
      }
    }
  }

  async close(): Promise<void> {
    await this.dispatcher.close?.();
    await this.broadcaster.close?.();
    await this.store.close?.();
  }
}

function deriveSessionTitle(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/)[0]?.trim() ?? 'New Chat';
  if (firstLine.length <= 56) return firstLine;
  return `${firstLine.slice(0, 53).trimEnd()}...`;
}
