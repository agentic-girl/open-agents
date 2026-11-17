import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AgentRuntime } from '../runtime.js';
import { AgentEvent } from '@open-agents/core';

export interface SessionRoutesOptions {
  runtime: AgentRuntime;
}

export const sessionRoutes: FastifyPluginAsync<SessionRoutesOptions> = async (
  fastify: FastifyInstance,
  options,
) => {
  const { runtime } = options;

  // 1. Create a new session
  fastify.post('/api/sessions', async (request, reply) => {
    const bodySchema = z.object({
      agentId: z.string().default('default-ops'),
      metadata: z.record(z.unknown()).optional(),
    });

    const parsed = bodySchema.parse(request.body || {});
    const session = await runtime.store.createSession({
      agentId: parsed.agentId,
      metadata: parsed.metadata,
    });

    return reply.status(201).send(session);
  });

  // 2. Get session details and active state
  fastify.get('/api/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await runtime.store.getSession(id);
    if (!session) {
      return reply.status(404).send({ error: `Session ${id} not found` });
    }

    const latestOffset = await runtime.store.getLatestOffset(id);
    return reply.send({
      ...session,
      latestOffset,
    });
  });

  // 3. Dispatch prompt to agent (Beyond Request/Response: returns 202 Accepted)
  fastify.post('/api/sessions/:id/prompt', async (request, reply) => {
    const { id } = request.params as { id: string };
    const bodySchema = z.object({
      prompt: z.string().min(1),
    });

    const parsed = bodySchema.parse(request.body);
    const session = await runtime.store.getSession(id);
    if (!session) {
      return reply.status(404).send({ error: `Session ${id} not found` });
    }

    // Launch background worker
    runtime.dispatchPrompt(id, parsed.prompt, session.agentId);

    return reply.status(202).send({
      sessionId: id,
      status: 'running',
      message: 'Task dispatched to background agent worker',
    });
  });

  // 4. The Durable Delta Transport Stream (Blind Cursor Sync)
  fastify.get('/api/sessions/:id/delta', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { cursor?: string };
    const afterCursor = query.cursor !== undefined ? parseInt(query.cursor, 10) : -1;

    const session = await runtime.store.getSession(id);
    if (!session) {
      return reply.status(404).send({ error: `Session ${id} not found` });
    }

    // Setup SSE / Chunked HTTP stream
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    let currentCursor = afterCursor;

    // 1. Immediately flush all unconsumed deltas
    const initialDeltas = await runtime.store.getDelta(id, currentCursor, 500);
    for (const event of initialDeltas) {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.offset > currentCursor) {
        currentCursor = event.offset;
      }
    }

    // Check if session is already in a terminal/suspended state
    const currentStatus = (await runtime.store.getSession(id))?.status;
    if (currentStatus === 'completed' || currentStatus === 'failed' || currentStatus === 'suspended') {
      reply.raw.write(`event: done\ndata: {"status":"${currentStatus}"}\n\n`);
      reply.raw.end();
      return;
    }

    // 2. Attach live subscriber for in-flight execution events
    const unsubscribe = runtime.store.subscribe(id, (event: AgentEvent) => {
      if (event.offset > currentCursor) {
        currentCursor = event.offset;
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);

        if (
          event.type === 'agent:completed' ||
          event.type === 'agent:failed' ||
          event.type === 'agent:suspended'
        ) {
          reply.raw.write(`event: done\ndata: {"status":"${event.type}"}\n\n`);
          cleanup();
          reply.raw.end();
        }
      }
    });

    const cleanup = () => {
      unsubscribe();
    };

    request.raw.on('close', cleanup);
    request.raw.on('end', cleanup);
  });

  // 5. Submit Human Approval Decision
  fastify.post('/api/sessions/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const bodySchema = z.object({
      interruptId: z.string(),
      approved: z.boolean(),
      modifiedArgs: z.record(z.unknown()).optional(),
      feedback: z.string().optional(),
    });

    const decision = bodySchema.parse(request.body);
    const session = await runtime.store.getSession(id);
    if (!session) {
      return reply.status(404).send({ error: `Session ${id} not found` });
    }

    // Dispatch resume asynchronously
    runtime.dispatchResume(decision, session.agentId);

    return reply.status(202).send({
      sessionId: id,
      interruptId: decision.interruptId,
      status: 'resuming',
    });
  });

  // 6. List available agents
  fastify.get('/api/agents', async () => {
    return runtime.listAgents();
  });
};
