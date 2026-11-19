import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { stream } from 'hono/streaming';
import { z, ZodError } from 'zod';
import {
  HarnessNotFoundError,
  type OpenAgentsEngine,
  SessionBusyError,
  SessionNotFoundError,
} from '@open-agents/core';

const createSessionSchema = z.object({
  title: z.string().max(200).optional(),
  harnessId: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  cwd: z.string().min(1).optional(),
});

const submitTurnSchema = z.object({
  prompt: z.string().trim().min(1, 'Prompt cannot be empty'),
  systemPrompt: z.string().optional(),
});

export function createServerApp(engine: OpenAgentsEngine): Hono {
  const app = new Hono();

  app.use(
    '/api/*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    }),
  );

  app.get('/api/health', (c) => {
    return c.json({
      status: 'ok',
      harnesses: engine.listHarnesses(),
      anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/harnesses', (c) => {
    return c.json({ harnesses: engine.listHarnesses() });
  });

  app.get('/api/sessions', async (c) => {
    const rawLimit = c.req.query('limit');
    const limit = rawLimit ? Math.min(Math.max(parseInt(rawLimit, 10) || 50, 1), 200) : 50;
    const sessions = await engine.listSessions(limit);
    return c.json({ sessions });
  });

  app.post('/api/sessions', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = createSessionSchema.parse(body);
    const session = await engine.createSession(parsed);
    return c.json(session, 201);
  });

  app.get('/api/sessions/:id', async (c) => {
    const session = await engine.getSession(c.req.param('id'));
    return c.json(session);
  });

  app.delete('/api/sessions/:id', async (c) => {
    const deleted = await engine.deleteSession(c.req.param('id'));
    if (!deleted) {
      throw new SessionNotFoundError(c.req.param('id'));
    }
    return c.body(null, 204);
  });

  app.get('/api/sessions/:id/status', async (c) => {
    c.header('Cache-Control', 'no-store');
    const snapshot = await engine.getSessionStatus(c.req.param('id'));
    return c.json(snapshot);
  });

  app.post('/api/sessions/:id/turns', async (c) => {
    const body = await c.req.json();
    const parsed = submitTurnSchema.parse(body);
    const result = await engine.submitTurn(c.req.param('id'), parsed.prompt, {
      systemPrompt: parsed.systemPrompt,
    });
    return c.json(result, 202);
  });

  app.post('/api/sessions/:id/abort', async (c) => {
    const aborted = await engine.abortTurn(c.req.param('id'));
    return c.json({ aborted });
  });

  /**
   * Pull-Initiated Push endpoint:
   * - Flushes all blocks with `seq > after` as NDJSON lines.
   * - If `idle` / `error`, writes `{"type":"done",...}` and closes HTTP response immediately.
   * - If `running`, keeps pushing live broadcast blocks until turn finishes, then closes.
   */
  app.get('/api/sessions/:id/sync', async (c) => {
    const sessionId = c.req.param('id');
    const rawAfter = c.req.query('after');
    const afterSeq = rawAfter !== undefined ? Math.max(0, parseInt(rawAfter, 10) || 0) : 0;

    // Validate session exists before opening stream headers so missing IDs return clean 404
    await engine.getSessionStatus(sessionId);

    c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('Connection', 'keep-alive');
    c.header('X-Accel-Buffering', 'no');

    return stream(c, async (s) => {
      const controller = new AbortController();
      s.onAbort(() => {
        controller.abort();
      });

      try {
        for await (const frame of engine.streamSync(
          sessionId,
          afterSeq,
          controller.signal,
        )) {
          if (controller.signal.aborted) break;
          await s.writeln(JSON.stringify(frame));
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error(`[sync] stream error on session ${sessionId}:`, err);
        }
      }
    });
  });

  app.onError((err, c) => {
    if (err instanceof SessionNotFoundError) {
      return c.json({ error: err.message, code: err.code }, 404);
    }
    if (err instanceof SessionBusyError) {
      return c.json({ error: err.message, code: err.code }, 409);
    }
    if (err instanceof HarnessNotFoundError) {
      return c.json({ error: err.message, code: err.code }, 400);
    }
    if (err instanceof ZodError) {
      return c.json(
        {
          error: err.issues.map((i) => i.message).join('; '),
          code: 'VALIDATION_ERROR',
        },
        400,
      );
    }

    console.error('[server] unhandled error:', err);
    return c.json(
      {
        error: err instanceof Error ? err.message : 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
      500,
    );
  });

  return app;
}
