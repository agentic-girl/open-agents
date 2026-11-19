export type SessionStatus = 'idle' | 'running' | 'error';

export interface Session {
  id: string;
  title: string;
  harnessId: string;
  model: string;
  cwd: string;
  harnessSessionId: string | null;
  status: SessionStatus;
  latestSeq: number;
  createdAt: string;
  updatedAt: string;
}

export interface SessionStatusSnapshot {
  id: string;
  status: SessionStatus;
  latestSeq: number;
  updatedAt: string;
}

export type BlockPayload =
  | {
      kind: 'user_message';
      text: string;
    }
  | {
      kind: 'thinking';
      thinking: string;
    }
  | {
      kind: 'assistant_message';
      text: string;
    }
  | {
      kind: 'tool_use';
      toolUseId: string;
      toolName: string;
      input: unknown;
    }
  | {
      kind: 'tool_result';
      toolUseId: string;
      toolName?: string;
      output: string;
      isError: boolean;
    }
  | {
      kind: 'turn_result';
      outcome: 'completed' | 'aborted' | 'error';
      durationMs: number;
      costUsd?: number;
      inputTokens?: number;
      outputTokens?: number;
      errorMessage?: string;
    };

export interface SessionBlock {
  seq: number;
  id: string;
  sessionId: string;
  turnId: string;
  createdAt: string;
  payload: BlockPayload;
}

export type SyncFrame =
  | {
      type: 'block';
      block: SessionBlock;
    }
  | {
      type: 'done';
      status: SessionStatus;
      latestSeq: number;
    };

export interface HarnessMetadata {
  id: string;
  displayName: string;
  defaultModel: string;
  supportedModels: string[];
}
