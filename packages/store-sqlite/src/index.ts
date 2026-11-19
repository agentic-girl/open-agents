import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  type BlockPayload,
  type CreateSessionInput,
  type Session,
  type SessionBlock,
  SessionNotFoundError,
  type SessionStatus,
  type SessionStatusSnapshot,
  type StoreAdapter,
  type UpdateSessionPatch,
} from '@open-agents/core';

export interface SqliteStoreOptions {
  dbPath?: string;
}

interface SessionRow {
  id: string;
  title: string;
  harness_id: string;
  model: string;
  cwd: string;
  harness_session_id: string | null;
  status: SessionStatus;
  latest_seq: number;
  created_at: string;
  updated_at: string;
}

interface BlockRow {
  seq: number;
  id: string;
  session_id: string;
  turn_id: string;
  created_at: string;
  payload_json: string;
}

export class SqliteStoreAdapter implements StoreAdapter {
  private readonly db: Database.Database;
  private readonly appendTx: Database.Transaction<
    (sessionId: string, turnId: string, payload: BlockPayload) => SessionBlock
  >;

  constructor(options: SqliteStoreOptions = {}) {
    const dbPath = options.dbPath ?? './data/open-agents.db';
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');

    this.migrate();

    const bumpSeqStmt = this.db.prepare<[string, string], { latest_seq: number }>(`
      UPDATE sessions
      SET latest_seq = latest_seq + 1,
          updated_at = ?
      WHERE id = ?
      RETURNING latest_seq
    `);

    const insertBlockStmt = this.db.prepare<
      [number, string, string, string, string, string]
    >(`
      INSERT INTO session_blocks (seq, id, session_id, turn_id, created_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.appendTx = this.db.transaction(
      (sessionId: string, turnId: string, payload: BlockPayload): SessionBlock => {
        const now = new Date().toISOString();
        const bumped = bumpSeqStmt.get(now, sessionId);
        if (!bumped) {
          throw new SessionNotFoundError(sessionId);
        }

        const seq = bumped.latest_seq;
        const id = `blk_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
        insertBlockStmt.run(
          seq,
          id,
          sessionId,
          turnId,
          now,
          JSON.stringify(payload),
        );

        return {
          seq,
          id,
          sessionId,
          turnId,
          createdAt: now,
          payload,
        };
      },
    );
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        harness_id TEXT NOT NULL,
        model TEXT NOT NULL,
        cwd TEXT NOT NULL,
        harness_session_id TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        latest_seq INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at
        ON sessions (updated_at DESC);

      CREATE TABLE IF NOT EXISTS session_blocks (
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        id TEXT NOT NULL UNIQUE,
        turn_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (session_id, seq),
        FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
      );
    `);

    // Recover any sessions orphaned in 'running' state by an unclean process crash
    this.db
      .prepare(`UPDATE sessions SET status = 'idle' WHERE status = 'running'`)
      .run();
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    const now = new Date().toISOString();
    const id = input.id ?? `sess_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const title = input.title?.trim() || 'New Chat';

    this.db
      .prepare(`
        INSERT INTO sessions (
          id, title, harness_id, model, cwd, harness_session_id, status, latest_seq, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, 'idle', 0, ?, ?)
      `)
      .run(id, title, input.harnessId, input.model, input.cwd, now, now);

    return {
      id,
      title,
      harnessId: input.harnessId,
      model: input.model,
      cwd: input.cwd,
      harnessSessionId: null,
      status: 'idle',
      latestSeq: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const row = this.db
      .prepare<[string], SessionRow>(`SELECT * FROM sessions WHERE id = ?`)
      .get(sessionId);
    return row ? mapSessionRow(row) : null;
  }

  async getSessionStatus(sessionId: string): Promise<SessionStatusSnapshot | null> {
    const row = this.db
      .prepare<
        [string],
        { id: string; status: SessionStatus; latest_seq: number; updated_at: string }
      >(`SELECT id, status, latest_seq, updated_at FROM sessions WHERE id = ?`)
      .get(sessionId);

    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      latestSeq: row.latest_seq,
      updatedAt: row.updated_at,
    };
  }

  async listSessions(limit = 100): Promise<Session[]> {
    const rows = this.db
      .prepare<[number], SessionRow>(
        `SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit);
    return rows.map(mapSessionRow);
  }

  async updateSession(sessionId: string, patch: UpdateSessionPatch): Promise<Session> {
    const current = await this.getSession(sessionId);
    if (!current) {
      throw new SessionNotFoundError(sessionId);
    }

    const updated: Session = {
      ...current,
      title: patch.title ?? current.title,
      status: patch.status ?? current.status,
      harnessSessionId:
        patch.harnessSessionId !== undefined
          ? patch.harnessSessionId
          : current.harnessSessionId,
      model: patch.model ?? current.model,
      updatedAt: new Date().toISOString(),
    };

    this.db
      .prepare(`
        UPDATE sessions
        SET title = ?,
            status = ?,
            harness_session_id = ?,
            model = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .run(
        updated.title,
        updated.status,
        updated.harnessSessionId,
        updated.model,
        updated.updatedAt,
        sessionId,
      );

    return updated;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const info = this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
    return info.changes > 0;
  }

  async appendBlock(
    sessionId: string,
    turnId: string,
    payload: BlockPayload,
  ): Promise<SessionBlock> {
    return this.appendTx(sessionId, turnId, payload);
  }

  async getBlocksAfter(
    sessionId: string,
    afterSeq: number,
    limit = 500,
  ): Promise<SessionBlock[]> {
    const rows = this.db
      .prepare<[string, number, number], BlockRow>(`
        SELECT seq, id, session_id, turn_id, created_at, payload_json
        FROM session_blocks
        WHERE session_id = ? AND seq > ?
        ORDER BY seq ASC
        LIMIT ?
      `)
      .all(sessionId, afterSeq, limit);

    return rows.map((row) => ({
      seq: row.seq,
      id: row.id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      createdAt: row.created_at,
      payload: JSON.parse(row.payload_json) as BlockPayload,
    }));
  }

  close(): void {
    this.db.close();
  }
}

function mapSessionRow(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    harnessId: row.harness_id,
    model: row.model,
    cwd: row.cwd,
    harnessSessionId: row.harness_session_id,
    status: row.status,
    latestSeq: row.latest_seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
