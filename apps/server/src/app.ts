import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z, ZodError } from 'zod';
import {
  createOpenAgentsHandler,
  type OpenAgentsEngine,
} from '@open-agents/core';

export const ANTHROPIC_KEY_SETTING = 'anthropic_api_key';

export interface CreateServerAppOptions {
  /**
   * Optional path to compiled frontend SPA directory (e.g. `apps/web/dist`).
   * When present, the Hono server serves both `/api/*` and the turnkey UI on a single port.
   */
  staticDir?: string;
}

const credentialsSchema = z.object({
  anthropicApiKey: z.string().nullable(),
});

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 10) return '••••••••';
  return `${trimmed.slice(0, 7)}...${trimmed.slice(-4)}`;
}

export async function resolveConfiguredAnthropicKey(
  engine: OpenAgentsEngine,
): Promise<{
  configured: boolean;
  source: 'env' | 'store' | 'oauth' | 'none';
  maskedKey: string | null;
  rawKey?: string;
}> {
  const storedKey = await engine.store.getSetting?.(ANTHROPIC_KEY_SETTING);
  if (storedKey && storedKey.trim()) {
    return {
      configured: true,
      source: 'store',
      maskedKey: maskSecret(storedKey),
      rawKey: storedKey.trim(),
    };
  }

  const envKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (envKey) {
    return {
      configured: true,
      source: 'env',
      maskedKey: maskSecret(envKey),
      rawKey: envKey,
    };
  }

  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
    return {
      configured: true,
      source: 'oauth',
      maskedKey: 'oauth-token',
    };
  }

  return {
    configured: false,
    source: 'none',
    maskedKey: null,
  };
}

export function createServerApp(
  engine: OpenAgentsEngine,
  options: CreateServerAppOptions = {},
): Hono {
  const app = new Hono();
  const coreHandler = createOpenAgentsHandler(engine, {
    basePath: '/api',
    cors: true,
  });

  app.use(
    '/api/*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
    }),
  );

  // Runtime credential status & zero-restart in-UI key setup
  app.get('/api/settings/credentials', async (c) => {
    c.header('Cache-Control', 'no-store');
    const status = await resolveConfiguredAnthropicKey(engine);
    return c.json({
      configured: status.configured,
      source: status.source,
      maskedKey: status.maskedKey,
    });
  });

  app.post('/api/settings/credentials', async (c) => {
    try {
      const body = await c.req.json();
      const parsed = credentialsSchema.parse(body);
      const cleaned = parsed.anthropicApiKey?.trim() || null;

      if (!engine.store.setSetting) {
        return c.json(
          { error: 'Active store adapter does not support runtime settings.' },
          501,
        );
      }

      await engine.store.setSetting(ANTHROPIC_KEY_SETTING, cleaned);
      const updated = await resolveConfiguredAnthropicKey(engine);
      return c.json({
        configured: updated.configured,
        source: updated.source,
        maskedKey: updated.maskedKey,
      });
    } catch (err) {
      if (err instanceof ZodError) {
        return c.json({ error: 'Invalid credentials payload' }, 400);
      }
      throw err;
    }
  });

  // Delegate all core OpenAgents protocol routes (`/api/sessions/*`, `/api/harnesses`, `/api/health`)
  app.all('/api/*', (c) => coreHandler(c.req.raw));

  // Optional single-port static SPA serving for turnkey Docker & CLI runs
  const staticRoot = options.staticDir ? path.resolve(options.staticDir) : null;
  const indexHtmlPath = staticRoot ? path.join(staticRoot, 'index.html') : null;

  if (staticRoot && indexHtmlPath && existsSync(indexHtmlPath)) {
    app.get('*', async (c) => {
      const reqPath = decodeURIComponent(c.req.path);
      const candidate = path.resolve(staticRoot, `.${reqPath}`);

      // Prevent path traversal outside staticRoot
      if (
        candidate.startsWith(`${staticRoot}${path.sep}`) &&
        existsSync(candidate)
      ) {
        const info = await stat(candidate);
        if (info.isFile()) {
          const ext = path.extname(candidate).toLowerCase();
          const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
          const bytes = await readFile(candidate);
          return new Response(bytes, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              ...(reqPath.startsWith('/assets/')
                ? { 'Cache-Control': 'public, max-age=31536000, immutable' }
                : {}),
            },
          });
        }
      }

      const html = await readFile(indexHtmlPath);
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    });
  }

  return app;
}
