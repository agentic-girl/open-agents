import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import { AgentRuntime } from '../src/runtime.js';
import { sessionRoutes } from '../src/routes/session-routes.js';
import * as fs from 'node:fs';

describe('OpenAgents Server Integration Tests', () => {
  let app: FastifyInstance;
  let runtime: AgentRuntime;
  const testDb = 'test-server.db';

  beforeEach(async () => {
    if (fs.existsSync(testDb)) {
      fs.unlinkSync(testDb);
    }

    runtime = new AgentRuntime(testDb);
    app = fastify();
    await app.register(sessionRoutes, { runtime });
  });

  afterEach(async () => {
    await app.close();
    if (fs.existsSync(testDb)) {
      fs.unlinkSync(testDb);
    }
  });

  it('creates a session and fetches details', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { agentId: 'default-ops' },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.id).toBeDefined();
    expect(body.status).toBe('idle');

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/sessions/${body.id}`,
    });

    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.body);
    expect(getBody.agentId).toBe('default-ops');
    expect(getBody.latestOffset).toBe(-1);
  });

  it('dispatches a prompt and handles human-in-the-loop approval workflow', async () => {
    // 1. Create session
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: { agentId: 'default-ops' },
    });
    const sessionId = JSON.parse(createRes.body).id;

    // 2. Dispatch prompt (Beyond request/response -> 202 Accepted)
    const promptRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/prompt`,
      payload: { prompt: 'Deploy payment-gateway to production' },
    });
    expect(promptRes.statusCode).toBe(202);

    // Wait briefly for agent worker to process until suspended at approval gate
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 3. Inspect delta: should see tool calls, and agent:suspended
    const deltaRes = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/delta?cursor=-1`,
    });
    expect(deltaRes.statusCode).toBe(200);

    // Parse SSE data lines
    const lines = deltaRes.body.split('\n\n').filter((l) => l.startsWith('data: '));
    const events = lines
      .map((l) => {
        try {
          return JSON.parse(l.replace('data: ', ''));
        } catch {
          return null;
        }
      })
      .filter((e) => e && e.type);

    const suspendedEvent = events.find((e) => e.type === 'agent:suspended');
    expect(suspendedEvent).toBeDefined();
    expect(suspendedEvent.payload.toolName).toBe('deployService');
    const interruptId = suspendedEvent.payload.interruptId;

    // 4. Submit approval
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessionId}/approve`,
      payload: {
        interruptId,
        approved: true,
      },
    });
    expect(approveRes.statusCode).toBe(202);

    // Wait briefly for agent to resume and complete
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 5. Blind delta request with cursor of last known event
    const lastOffset = suspendedEvent.offset;
    const finalDeltaRes = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/delta?cursor=${lastOffset}`,
    });

    const finalLines = finalDeltaRes.body.split('\n\n').filter((l) => l.startsWith('data: '));
    const resumeEvents = finalLines
      .map((l) => {
        try {
          return JSON.parse(l.replace('data: ', ''));
        } catch {
          return null;
        }
      })
      .filter((e) => e && e.type);

    const resumed = resumeEvents.find((e) => e.type === 'agent:resumed');
    expect(resumed).toBeDefined();
    expect(resumed.payload.approved).toBe(true);

    const completed = resumeEvents.find((e) => e.type === 'agent:completed');
    expect(completed).toBeDefined();
  });
});
