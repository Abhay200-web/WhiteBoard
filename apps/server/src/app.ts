import type { Db } from '@whiteboard/db';
import Fastify, { type FastifyInstance } from 'fastify';

import { hostRoutes } from './routes/host';

export interface AppOptions {
  db: Db;
  logger?: boolean;
}

export function buildApp({ db, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });
  app.register(hostRoutes, { db });
  return app;
}
