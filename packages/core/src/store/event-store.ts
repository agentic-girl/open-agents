import {
  AgentEvent,
  NewAgentEvent,
  Session,
  CreateSessionOptions,
  SessionStatus,
  Interrupt,
  ApprovalDecision,
} from '../types/index.js';

export interface EventStore {
  /**
   * Session Management
   */
  createSession(options: CreateSessionOptions): Promise<Session>;
  getSession(sessionId: string): Promise<Session | null>;
  updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void>;

  /**
   * Monotonic Event Append & Delta Queries
   */
  appendEvent(event: NewAgentEvent): Promise<AgentEvent>;
  getDelta(sessionId: string, afterCursor?: number, limit?: number): Promise<AgentEvent[]>;
  getLatestOffset(sessionId: string): Promise<number>;

  /**
   * Human-In-The-Loop Interrupts
   */
  createInterrupt(interrupt: Omit<Interrupt, 'status' | 'createdAt'>): Promise<Interrupt>;
  getInterrupt(interruptId: string): Promise<Interrupt | null>;
  resolveInterrupt(decision: ApprovalDecision): Promise<Interrupt>;

  /**
   * Live Event Subscription (Local Pub/Sub)
   */
  subscribe(sessionId: string, callback: (event: AgentEvent) => void): () => void;
  
  /**
   * Lifecycle cleanup
   */
  close?(): Promise<void> | void;
}
