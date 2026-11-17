import { EventEmitter } from 'node:events';
import {
  AgentEvent,
  NewAgentEvent,
  Session,
  CreateSessionOptions,
  SessionStatus,
  Interrupt,
  ApprovalDecision,
} from '../types/index.js';
import { EventStore } from './event-store.js';

export class MemoryEventStore implements EventStore {
  private sessions = new Map<string, Session>();
  private events = new Map<string, AgentEvent[]>();
  private interrupts = new Map<string, Interrupt>();
  private emitter = new EventEmitter();

  async createSession(options: CreateSessionOptions): Promise<Session> {
    const id = options.id || `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();
    const session: Session = {
      id,
      agentId: options.agentId,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      metadata: options.metadata || {},
    };
    this.sessions.set(id, session);
    this.events.set(id, []);
    return session;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) || null;
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    session.status = status;
    session.updatedAt = Date.now();
  }

  async appendEvent(event: NewAgentEvent): Promise<AgentEvent> {
    const sessionEvents = this.events.get(event.sessionId);
    if (!sessionEvents) {
      throw new Error(`Session ${event.sessionId} not found in event store`);
    }

    const offset = sessionEvents.length;
    const committedEvent: AgentEvent = {
      offset,
      sessionId: event.sessionId,
      type: event.type,
      timestamp: Date.now(),
      payload: event.payload,
    };

    sessionEvents.push(committedEvent);
    this.emitter.emit(`event:${event.sessionId}`, committedEvent);
    return committedEvent;
  }

  async getDelta(sessionId: string, afterCursor = -1, limit = 100): Promise<AgentEvent[]> {
    const sessionEvents = this.events.get(sessionId);
    if (!sessionEvents) {
      return [];
    }

    // Filter events strictly with offset > afterCursor
    return sessionEvents
      .filter((ev) => ev.offset > afterCursor)
      .slice(0, limit);
  }

  async getLatestOffset(sessionId: string): Promise<number> {
    const sessionEvents = this.events.get(sessionId);
    if (!sessionEvents || sessionEvents.length === 0) {
      return -1;
    }
    return sessionEvents[sessionEvents.length - 1].offset;
  }

  async createInterrupt(interruptData: Omit<Interrupt, 'status' | 'createdAt'>): Promise<Interrupt> {
    const now = Date.now();
    const interrupt: Interrupt = {
      ...interruptData,
      status: 'pending',
      createdAt: now,
    };
    this.interrupts.set(interrupt.id, interrupt);
    return interrupt;
  }

  async getInterrupt(interruptId: string): Promise<Interrupt | null> {
    return this.interrupts.get(interruptId) || null;
  }

  async resolveInterrupt(decision: ApprovalDecision): Promise<Interrupt> {
    const interrupt = this.interrupts.get(decision.interruptId);
    if (!interrupt) {
      throw new Error(`Interrupt ${decision.interruptId} not found`);
    }
    if (interrupt.status !== 'pending') {
      throw new Error(`Interrupt ${decision.interruptId} is already ${interrupt.status}`);
    }

    interrupt.status = decision.approved ? 'approved' : 'rejected';
    interrupt.resolvedAt = Date.now();
    if (decision.modifiedArgs) {
      interrupt.toolArgs = decision.modifiedArgs;
    }
    return interrupt;
  }

  subscribe(sessionId: string, callback: (event: AgentEvent) => void): () => void {
    const channel = `event:${sessionId}`;
    this.emitter.on(channel, callback);
    return () => {
      this.emitter.off(channel, callback);
    };
  }
}
