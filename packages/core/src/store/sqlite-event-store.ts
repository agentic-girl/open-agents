import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
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

export interface SqliteEventStoreOptions {
  dbPath?: string;
}

export class SqliteEventStore implements EventStore {
  private db: Database.Database;
  private emitter = new EventEmitter();

  constructor(options: SqliteEventStoreOptions = {}) {
    const dbPath = options.dbPath || 'open-agents.db';
    this.db = new Database(dbPath);

    // High performance WAL configuration
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        session_id TEXT NOT NULL,
        offset INTEGER NOT NULL,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (session_id, offset),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_events_delta ON events(session_id, offset);

      CREATE TABLE IF NOT EXISTS interrupts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        tool_name TEXT,
        tool_args TEXT,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
  }

  async createSession(options: CreateSessionOptions): Promise<Session> {
    const id = options.id || `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();
    const metadata = JSON.stringify(options.metadata || {});

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, agent_id, status, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, options.agentId, 'idle', now, now, metadata);

    return {
      id,
      agentId: options.agentId,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      metadata: options.metadata || {},
    };
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
      | {
          id: string;
          agent_id: string;
          status: string;
          created_at: number;
          updated_at: number;
          metadata: string;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      agentId: row.agent_id,
      status: row.status as SessionStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: JSON.parse(row.metadata),
    };
  }

  async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
    const now = Date.now();
    const result = this.db
      .prepare('UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, sessionId);

    if (result.changes === 0) {
      throw new Error(`Session ${sessionId} not found`);
    }
  }

  async appendEvent(event: NewAgentEvent): Promise<AgentEvent> {
    const now = Date.now();
    const payloadStr = JSON.stringify(event.payload);

    // Compute next monotonic offset transactionally
    const appendTx = this.db.transaction(() => {
      const offsetRow = this.db
        .prepare('SELECT COALESCE(MAX(offset), -1) + 1 AS next_offset FROM events WHERE session_id = ?')
        .get(event.sessionId) as { next_offset: number };

      const nextOffset = offsetRow.next_offset;

      this.db
        .prepare(`
          INSERT INTO events (session_id, offset, type, timestamp, payload)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(event.sessionId, nextOffset, event.type, now, payloadStr);

      return nextOffset;
    });

    const offset = appendTx();

    const committed: AgentEvent = {
      offset,
      sessionId: event.sessionId,
      type: event.type,
      timestamp: now,
      payload: event.payload,
    };

    this.emitter.emit(`event:${event.sessionId}`, committed);
    return committed;
  }

  async getDelta(sessionId: string, afterCursor = -1, limit = 100): Promise<AgentEvent[]> {
    const rows = this.db
      .prepare(`
        SELECT offset, session_id, type, timestamp, payload
        FROM events
        WHERE session_id = ? AND offset > ?
        ORDER BY offset ASC
        LIMIT ?
      `)
      .all(sessionId, afterCursor, limit) as Array<{
      offset: number;
      session_id: string;
      type: string;
      timestamp: number;
      payload: string;
    }>;

    return rows.map((r) => ({
      offset: r.offset,
      sessionId: r.session_id,
      type: r.type as AgentEvent['type'],
      timestamp: r.timestamp,
      payload: JSON.parse(r.payload),
    }));
  }

  async getLatestOffset(sessionId: string): Promise<number> {
    const row = this.db
      .prepare('SELECT MAX(offset) AS max_offset FROM events WHERE session_id = ?')
      .get(sessionId) as { max_offset: number | null } | undefined;

    return row?.max_offset ?? -1;
  }

  async createInterrupt(interruptData: Omit<Interrupt, 'status' | 'createdAt'>): Promise<Interrupt> {
    const now = Date.now();
    const toolArgsStr = interruptData.toolArgs ? JSON.stringify(interruptData.toolArgs) : null;

    this.db
      .prepare(`
        INSERT INTO interrupts (id, session_id, type, status, tool_name, tool_args, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        interruptData.id,
        interruptData.sessionId,
        interruptData.type,
        'pending',
        interruptData.toolName || null,
        toolArgsStr,
        interruptData.reason,
        now,
      );

    return {
      ...interruptData,
      status: 'pending',
      createdAt: now,
    };
  }

  async getInterrupt(interruptId: string): Promise<Interrupt | null> {
    const row = this.db
      .prepare('SELECT * FROM interrupts WHERE id = ?')
      .get(interruptId) as
      | {
          id: string;
          session_id: string;
          type: string;
          status: string;
          tool_name: string | null;
          tool_args: string | null;
          reason: string;
          created_at: number;
          resolved_at: number | null;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      sessionId: row.session_id,
      type: row.type as Interrupt['type'],
      status: row.status as Interrupt['status'],
      toolName: row.tool_name || undefined,
      toolArgs: row.tool_args ? JSON.parse(row.tool_args) : undefined,
      reason: row.reason,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at || undefined,
    };
  }

  async resolveInterrupt(decision: ApprovalDecision): Promise<Interrupt> {
    const now = Date.now();
    const newStatus = decision.approved ? 'approved' : 'rejected';
    const modifiedArgsStr = decision.modifiedArgs ? JSON.stringify(decision.modifiedArgs) : null;

    const resolveTx = this.db.transaction(() => {
      const current = this.db
        .prepare('SELECT * FROM interrupts WHERE id = ?')
        .get(decision.interruptId) as
        | {
            id: string;
            session_id: string;
            type: string;
            status: string;
            tool_name: string | null;
            tool_args: string | null;
            reason: string;
            created_at: number;
          }
        | undefined;

      if (!current) {
        throw new Error(`Interrupt ${decision.interruptId} not found`);
      }
      if (current.status !== 'pending') {
        throw new Error(`Interrupt ${decision.interruptId} is already ${current.status}`);
      }

      if (decision.modifiedArgs) {
        this.db
          .prepare('UPDATE interrupts SET status = ?, resolved_at = ?, tool_args = ? WHERE id = ?')
          .run(newStatus, now, modifiedArgsStr, decision.interruptId);
      } else {
        this.db
          .prepare('UPDATE interrupts SET status = ?, resolved_at = ? WHERE id = ?')
          .run(newStatus, now, decision.interruptId);
      }

      return {
        id: current.id,
        sessionId: current.session_id,
        type: current.type as Interrupt['type'],
        status: newStatus as Interrupt['status'],
        toolName: current.tool_name || undefined,
        toolArgs: decision.modifiedArgs || (current.tool_args ? JSON.parse(current.tool_args) : undefined),
        reason: current.reason,
        createdAt: current.created_at,
        resolvedAt: now,
      };
    });

    return resolveTx();
  }

  subscribe(sessionId: string, callback: (event: AgentEvent) => void): () => void {
    const channel = `event:${sessionId}`;
    this.emitter.on(channel, callback);
    return () => {
      this.emitter.off(channel, callback);
    };
  }

  close(): void {
    this.db.close();
  }
}
