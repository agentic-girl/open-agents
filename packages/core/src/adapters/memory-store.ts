import { randomUUID } from 'node:crypto';
import { SessionNotFoundError } from '../errors.js';
import type { CreateSessionInput, StoreAdapter, UpdateSessionPatch } from '../ports.js';
import type { BlockPayload, Session, SessionBlock, SessionStatusSnapshot } from '../types.js';

export class MemoryStoreAdapter implements StoreAdapter {
  private readonly sessions = new Map<string, Session>();
  private readonly blocks = new Map<string, SessionBlock[]>();
  private readonly settings = new Map<string, string>();

  async createSession(input: CreateSessionInput): Promise<Session> {
    const now = new Date().toISOString();
    const id = input.id ?? `sess_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const session: Session = {
      id,
      title: input.title?.trim() || 'New Chat',
      harnessId: input.harnessId,
      model: input.model,
      cwd: input.cwd,
      harnessSessionId: null,
      status: 'idle',
      latestSeq: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(id, session);
    this.blocks.set(id, []);
    return { ...session };
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : null;
  }

  async getSessionStatus(sessionId: string): Promise<SessionStatusSnapshot | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      id: session.id,
      status: session.status,
      latestSeq: session.latestSeq,
      updatedAt: session.updatedAt,
    };
  }

  async listSessions(limit = 100): Promise<Session[]> {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((s) => ({ ...s }));
  }

  async updateSession(sessionId: string, patch: UpdateSessionPatch): Promise<Session> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    if (patch.title !== undefined) session.title = patch.title;
    if (patch.status !== undefined) session.status = patch.status;
    if (patch.harnessSessionId !== undefined) session.harnessSessionId = patch.harnessSessionId;
    if (patch.model !== undefined) session.model = patch.model;
    session.updatedAt = new Date().toISOString();

    return { ...session };
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    this.blocks.delete(sessionId);
    return this.sessions.delete(sessionId);
  }

  async appendBlock(
    sessionId: string,
    turnId: string,
    payload: BlockPayload,
  ): Promise<SessionBlock> {
    const session = this.sessions.get(sessionId);
    const list = this.blocks.get(sessionId);
    if (!session || !list) {
      throw new SessionNotFoundError(sessionId);
    }

    const now = new Date().toISOString();
    const seq = session.latestSeq + 1;
    session.latestSeq = seq;
    session.updatedAt = now;

    const block: SessionBlock = {
      seq,
      id: `blk_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      sessionId,
      turnId,
      createdAt: now,
      payload,
    };

    list.push(block);
    return block;
  }

  async getBlocksAfter(
    sessionId: string,
    afterSeq: number,
    limit = 500,
  ): Promise<SessionBlock[]> {
    const list = this.blocks.get(sessionId);
    if (!list) return [];
    return list.filter((b) => b.seq > afterSeq).slice(0, limit);
  }

  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key) ?? null;
  }

  async setSetting(key: string, value: string | null): Promise<void> {
    if (value === null) {
      this.settings.delete(key);
    } else {
      this.settings.set(key, value);
    }
  }
}
