import type {
  BlockPayload,
  Session,
  SessionBlock,
  SessionStatus,
  SessionStatusSnapshot,
} from './types.js';

export interface HarnessTurnContext {
  sessionId: string;
  turnId: string;
  prompt: string;
  cwd: string;
  model: string;
  systemPrompt?: string;
  harnessSessionId: string | null;
  signal: AbortSignal;
  onHarnessSessionId: (nativeSessionId: string) => Promise<void>;
  emit: (payload: BlockPayload) => Promise<SessionBlock>;
}

export interface HarnessAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly defaultModel: string;
  readonly supportedModels?: readonly string[];
  runTurn(ctx: HarnessTurnContext): Promise<void>;
}

export interface CreateSessionInput {
  id?: string;
  title?: string;
  harnessId: string;
  model: string;
  cwd: string;
}

export interface UpdateSessionPatch {
  title?: string;
  status?: SessionStatus;
  harnessSessionId?: string | null;
  model?: string;
}

export interface StoreAdapter {
  createSession(input: CreateSessionInput): Promise<Session>;
  getSession(sessionId: string): Promise<Session | null>;
  getSessionStatus(sessionId: string): Promise<SessionStatusSnapshot | null>;
  listSessions(limit?: number): Promise<Session[]>;
  updateSession(sessionId: string, patch: UpdateSessionPatch): Promise<Session>;
  deleteSession(sessionId: string): Promise<boolean>;

  appendBlock(sessionId: string, turnId: string, payload: BlockPayload): Promise<SessionBlock>;
  getBlocksAfter(sessionId: string, afterSeq: number, limit?: number): Promise<SessionBlock[]>;

  close?(): Promise<void> | void;
}

export type BroadcastFrame =
  | {
      type: 'block';
      block: SessionBlock;
    }
  | {
      type: 'status';
      sessionId: string;
      status: SessionStatus;
      latestSeq: number;
    };

export interface BroadcasterAdapter {
  publish(sessionId: string, frame: BroadcastFrame): Promise<void> | void;
  subscribe(sessionId: string, listener: (frame: BroadcastFrame) => void): () => void;
  close?(): Promise<void> | void;
}

export interface TurnJob {
  sessionId: string;
  turnId: string;
  prompt: string;
  systemPrompt?: string;
}

export type TurnJobHandler = (job: TurnJob, signal: AbortSignal) => Promise<void>;

export interface TurnDispatcherAdapter {
  registerHandler(handler: TurnJobHandler): void;
  enqueue(job: TurnJob): Promise<void>;
  abort(sessionId: string): Promise<boolean>;
  close?(): Promise<void> | void;
}
