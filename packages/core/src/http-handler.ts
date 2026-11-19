import type { OpenAgentsEngine } from './engine.js';
import { HarnessNotFoundError, SessionBusyError, SessionNotFoundError } from './errors.js';

export interface OpenAgentsHttpHandlerOptions {
  /**
   * URL path prefix where routes are mounted. Defaults to `/api`.
   * Example: `/api/agents` mounts `/api/agents/sessions`, `/api/agents/harnesses`, etc.
   */
  basePath?: string;
  /**
   * Include permissive CORS headers (`Access-Control-Allow-Origin: *`). Defaults to `true`.
   */
  cors?: boolean;
}

export type OpenAgentsFetchHandler = (request: Request) => Promise<Response>;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Creates a zero-dependency, Web-Standard `Request -> Promise<Response>` HTTP handler
 * that can be mounted in Hono, Next.js App Router, Bun.serve, Deno, or Node.js in ~5 lines.
 */
export function createOpenAgentsHandler(
  engine: OpenAgentsEngine,
  options: OpenAgentsHttpHandlerOptions = {},
): OpenAgentsFetchHandler {
  const normalizedBase = normalizeBasePath(options.basePath ?? '/api');
  const enableCors = options.cors ?? true;

  const withHeaders = (extra: Record<string, string> = {}): Record<string, string> =>
    enableCors ? { ...CORS_HEADERS, ...extra } : { ...extra };

  const json = (data: unknown, status = 200, extraHeaders?: Record<string, string>) =>
    new Response(JSON.stringify(data), {
      status,
      headers: withHeaders({
        'Content-Type': 'application/json; charset=utf-8',
        ...extraHeaders,
      }),
    });

  return async (request: Request): Promise<Response> => {
    if (enableCors && request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: withHeaders() });
    }

    const url = new URL(request.url, 'http://localhost');
    const subPath = stripBasePath(url.pathname, normalizedBase);
    if (subPath === null) {
      return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);
    }

    const segments = subPath.split('/').filter(Boolean);
    const method = request.method.toUpperCase();

    try {
      // GET /health
      if (method === 'GET' && segments.length === 1 && segments[0] === 'health') {
        return json({
          status: 'ok',
          harnesses: engine.listHarnesses(),
          timestamp: new Date().toISOString(),
        });
      }

      // GET /harnesses
      if (method === 'GET' && segments.length === 1 && segments[0] === 'harnesses') {
        return json({ harnesses: engine.listHarnesses() });
      }

      // GET /sessions | POST /sessions
      if (segments.length === 1 && segments[0] === 'sessions') {
        if (method === 'GET') {
          const rawLimit = url.searchParams.get('limit');
          const limit = rawLimit
            ? Math.min(Math.max(parseInt(rawLimit, 10) || 50, 1), 200)
            : 50;
          const sessions = await engine.listSessions(limit);
          return json({ sessions });
        }

        if (method === 'POST') {
          const body = await parseJsonObject(request);
          const session = await engine.createSession({
            title: optionalString(body.title, 200),
            harnessId: optionalString(body.harnessId),
            model: optionalString(body.model),
            cwd: optionalString(body.cwd),
          });
          return json(session, 201);
        }
      }

      // /sessions/:id
      if (segments.length === 2 && segments[0] === 'sessions') {
        const sessionId = decodeURIComponent(segments[1]!);

        if (method === 'GET') {
          const session = await engine.getSession(sessionId);
          return json(session);
        }

        if (method === 'DELETE') {
          const deleted = await engine.deleteSession(sessionId);
          if (!deleted) {
            throw new SessionNotFoundError(sessionId);
          }
          return new Response(null, { status: 204, headers: withHeaders() });
        }
      }

      // /sessions/:id/:action
      if (segments.length === 3 && segments[0] === 'sessions') {
        const sessionId = decodeURIComponent(segments[1]!);
        const action = segments[2];

        // GET /sessions/:id/status
        if (method === 'GET' && action === 'status') {
          const snapshot = await engine.getSessionStatus(sessionId);
          return json(snapshot, 200, { 'Cache-Control': 'no-store' });
        }

        // POST /sessions/:id/turns
        if (method === 'POST' && action === 'turns') {
          const body = await parseJsonObject(request);
          const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
          if (!prompt) {
            return json(
              { error: 'Prompt cannot be empty', code: 'VALIDATION_ERROR' },
              400,
            );
          }
          const result = await engine.submitTurn(sessionId, prompt, {
            systemPrompt: optionalString(body.systemPrompt),
          });
          return json(result, 202);
        }

        // POST /sessions/:id/abort
        if (method === 'POST' && action === 'abort') {
          const aborted = await engine.abortTurn(sessionId);
          return json({ aborted });
        }

        // GET /sessions/:id/sync?after=<seq> (Pull-Initiated Push NDJSON stream)
        if (method === 'GET' && action === 'sync') {
          const rawAfter = url.searchParams.get('after');
          const afterSeq =
            rawAfter !== null ? Math.max(0, parseInt(rawAfter, 10) || 0) : 0;

          // Validate session existence before opening stream headers
          await engine.getSessionStatus(sessionId);

          const abortController = new AbortController();
          request.signal?.addEventListener(
            'abort',
            () => abortController.abort(),
            { once: true },
          );

          const encoder = new TextEncoder();
          const iterator = engine.streamSync(
            sessionId,
            afterSeq,
            abortController.signal,
          );

          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const { value, done } = await iterator.next();
                if (done) {
                  controller.close();
                  return;
                }
                controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
              } catch (err) {
                abortController.abort();
                controller.error(err);
              }
            },
            async cancel() {
              abortController.abort();
              await iterator.return?.();
            },
          });

          return new Response(body, {
            status: 200,
            headers: withHeaders({
              'Content-Type': 'application/x-ndjson; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              'Connection': 'keep-alive',
              'X-Accel-Buffering': 'no',
            }),
          });
        }
      }

      return json({ error: 'Route not found', code: 'NOT_FOUND' }, 404);
    } catch (err: unknown) {
      if (err instanceof SessionNotFoundError) {
        return json({ error: err.message, code: err.code }, 404);
      }
      if (err instanceof SessionBusyError) {
        return json({ error: err.message, code: err.code }, 409);
      }
      if (err instanceof HarnessNotFoundError) {
        return json({ error: err.message, code: err.code }, 400);
      }
      if (err instanceof ValidationHttpError) {
        return json({ error: err.message, code: 'VALIDATION_ERROR' }, 400);
      }
      return json(
        {
          error: err instanceof Error ? err.message : 'Internal server error',
          code: 'INTERNAL_ERROR',
        },
        500,
      );
    }
  };
}

class ValidationHttpError extends Error {}

async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ValidationHttpError('Expected JSON object body');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof ValidationHttpError) throw err;
    throw new ValidationHttpError('Invalid JSON body');
  }
}

function optionalString(val: unknown, maxLen?: number): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'string') {
    throw new ValidationHttpError('Expected string field');
  }
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  if (maxLen !== undefined && trimmed.length > maxLen) {
    throw new ValidationHttpError(`Field exceeds maximum length of ${maxLen}`);
  }
  return trimmed;
}

function normalizeBasePath(basePath: string): string {
  const clean = basePath.trim().replace(/\/+$/, '');
  if (!clean || clean === '/') return '';
  return clean.startsWith('/') ? clean : `/${clean}`;
}

function stripBasePath(pathname: string, basePath: string): string | null {
  if (!basePath) return pathname;
  if (pathname === basePath) return '/';
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length);
  }
  return null;
}
