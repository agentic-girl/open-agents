import fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { AgentRuntime } from './runtime.js';
import { sessionRoutes } from './routes/session-routes.js';

dotenv.config();

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const host = process.env.HOST || '0.0.0.0';

async function bootstrap() {
  const app = fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
    },
  });

  await app.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  const runtime = new AgentRuntime(process.env.DATABASE_PATH);

  await app.register(sessionRoutes, { runtime });

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: Date.now(),
    agents: runtime.listAgents(),
  }));

  try {
    await app.listen({ port, host });
    console.log(`
🚀 OpenAgents Server is running at http://${host}:${port}
📡 Durable Delta Transport active on /api/sessions/:id/delta
🤖 Active Agents: ${runtime.listAgents().map((a) => a.id).join(', ')}
    `);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap();
