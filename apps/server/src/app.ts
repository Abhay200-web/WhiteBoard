import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Db } from '@whiteboard/db';
import Fastify, { type FastifyInstance } from 'fastify';

import { authRoutes } from './routes/auth';
import { backupRoutes } from './routes/backups';
import { fileRoutes } from './routes/files';
import { hostRoutes } from './routes/host';
import { hostSettingsRoutes } from './routes/host-settings';
import { inviteRoutes } from './routes/invites';
import { memberRoutes } from './routes/members';
import { projectRoutes } from './routes/projects';
import { setupRoutes, type RateLimitOptions } from './routes/setup';

export interface AppOptions {
  db: Db;
  /** Host data folder; uploaded files live in `<dataDir>/files`. */
  dataDir: string;
  logger?: boolean;
  /** Limit for sign-in / setup / change-password, per client IP. Tests lower it. */
  authRateLimit?: RateLimitOptions;
}

export function buildApp({
  db,
  dataDir,
  logger = false,
  authRateLimit = { max: 10, timeWindow: '1 minute' },
}: AppOptions): FastifyInstance {
  const app = Fastify({ logger });
  // The web UI runs on another origin (desktop app / dev server). Auth is a bearer header, not
  // cookies, so allowing any origin does not expose sessions.
  app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['authorization', 'content-type', 'range'],
    exposedHeaders: ['content-range', 'accept-ranges', 'content-length'],
  });
  // `global: false`: only routes that set `config.rateLimit` are limited.
  app.register(rateLimit, { global: false });
  app.register(hostRoutes, { db });
  app.register(setupRoutes, { db, rateLimit: authRateLimit });
  app.register(authRoutes, { db, rateLimit: authRateLimit });
  app.register(inviteRoutes, { db, rateLimit: authRateLimit });
  app.register(memberRoutes, { db });
  app.register(fileRoutes, { db, dataDir });
  app.register(backupRoutes, { db, dataDir });
  app.register(projectRoutes, { db });
  app.register(hostSettingsRoutes, { db, dataDir });
  return app;
}
