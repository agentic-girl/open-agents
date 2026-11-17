import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryEventStore, SqliteEventStore } from '../src/store/index.js';
import { EventStore } from '../src/store/event-store.js';
import * as fs from 'node:fs';

describe('EventStore Implementations', () => {
  const runStoreTests = (name: string, createStore: () => EventStore) => {
    describe(name, () => {
      let store: EventStore;

      beforeEach(async () => {
        store = createStore();
      });

      afterEach(async () => {
        if (store.close) {
          await store.close();
        }
      });

      it('creates and retrieves a session', async () => {
        const session = await store.createSession({
          id: 'test-session-1',
          agentId: 'agent-alpha',
          metadata: { env: 'test' },
        });

        expect(session.id).toBe('test-session-1');
        expect(session.status).toBe('idle');

        const fetched = await store.getSession('test-session-1');
        expect(fetched).not.toBeNull();
        expect(fetched?.agentId).toBe('agent-alpha');
      });

      it('maintains strict monotonic offsets for events', async () => {
        await store.createSession({ id: 's1', agentId: 'a1' });

        const ev0 = await store.appendEvent({
          sessionId: 's1',
          type: 'agent:started',
          payload: { prompt: 'hello' },
        });

        const ev1 = await store.appendEvent({
          sessionId: 's1',
          type: 'agent:thought',
          payload: { text: 'thinking' },
        });

        const ev2 = await store.appendEvent({
          sessionId: 's1',
          type: 'agent:completed',
          payload: { result: 'done' },
        });

        expect(ev0.offset).toBe(0);
        expect(ev1.offset).toBe(1);
        expect(ev2.offset).toBe(2);

        const latest = await store.getLatestOffset('s1');
        expect(latest).toBe(2);
      });

      it('fetches exact deltas after a cursor', async () => {
        await store.createSession({ id: 's2', agentId: 'a2' });

        for (let i = 0; i < 5; i++) {
          await store.appendEvent({
            sessionId: 's2',
            type: 'agent:message',
            payload: { chunk: `token_${i}` },
          });
        }

        // Fetch delta after cursor 1 -> should return offsets 2, 3, 4
        const delta = await store.getDelta('s2', 1);
        expect(delta).toHaveLength(3);
        expect(delta.map((d) => d.offset)).toEqual([2, 3, 4]);

        // Fetch delta after cursor 4 -> should return empty
        const emptyDelta = await store.getDelta('s2', 4);
        expect(emptyDelta).toHaveLength(0);
      });

      it('handles interrupt creation and resolution', async () => {
        await store.createSession({ id: 's3', agentId: 'a3' });

        const interrupt = await store.createInterrupt({
          id: 'int-123',
          sessionId: 's3',
          type: 'tool_approval',
          toolName: 'dropTable',
          toolArgs: { table: 'users' },
          reason: 'Destructive operation requires operator approval',
        });

        expect(interrupt.status).toBe('pending');

        const fetched = await store.getInterrupt('int-123');
        expect(fetched?.status).toBe('pending');
        expect(fetched?.toolName).toBe('dropTable');

        const resolved = await store.resolveInterrupt({
          interruptId: 'int-123',
          approved: true,
          feedback: 'Proceed with caution',
        });

        expect(resolved.status).toBe('approved');
        expect(resolved.resolvedAt).toBeDefined();
      });
    });
  };

  runStoreTests('MemoryEventStore', () => new MemoryEventStore());

  const testDbFile = 'test-events.db';
  runStoreTests('SqliteEventStore', () => {
    if (fs.existsSync(testDbFile)) {
      fs.unlinkSync(testDbFile);
    }
    return new SqliteEventStore({ dbPath: testDbFile });
  });
});
