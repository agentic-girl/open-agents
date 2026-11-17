export type AgentEventType =
  | 'agent:started'
  | 'agent:thought'
  | 'tool:called'
  | 'tool:result'
  | 'agent:suspended'
  | 'agent:resumed'
  | 'agent:message'
  | 'agent:completed'
  | 'agent:failed';

export interface AgentEvent {
  offset: number;
  sessionId: string;
  type: AgentEventType;
  timestamp: number;
  payload: Record<string, any>;
}

export type SessionStatus = 'idle' | 'running' | 'suspended' | 'completed' | 'failed';

export interface Session {
  id: string;
  agentId: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
  latestOffset?: number;
}

export interface PendingInterrupt {
  interruptId: string;
  toolName?: string;
  toolArgs?: Record<string, any>;
  reason: string;
}
