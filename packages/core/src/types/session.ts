export type SessionStatus = 'idle' | 'running' | 'suspended' | 'completed' | 'failed';

export interface Session {
  id: string;
  agentId: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

export interface CreateSessionOptions {
  id?: string;
  agentId: string;
  metadata?: Record<string, unknown>;
}
