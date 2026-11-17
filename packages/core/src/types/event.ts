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
  payload: Record<string, unknown>;
}

export type NewAgentEvent = Omit<AgentEvent, 'offset' | 'timestamp'>;

export interface EventQueryOptions {
  afterCursor?: number;
  limit?: number;
  types?: AgentEventType[];
}
