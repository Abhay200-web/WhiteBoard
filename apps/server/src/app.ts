import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Db } from '@whiteboard/db';
import Fastify, { type FastifyInstance } from 'fastify';

import { EventHub } from './events/hub';
import { activityRoutes } from './routes/activity';
import { authRoutes } from './routes/auth';
import { backupRoutes } from './routes/backups';
import { onEventsConnection } from './routes/events';
import { createCollab, type CollabOptions } from './realtime/collab';
import { routeUpgrades } from './realtime/router';
import { fileRoutes } from './routes/files';
import { hostRoutes } from './routes/host';
import { hostSettingsRoutes } from './routes/host-settings';
import { inviteRoutes } from './routes/invites';
import { memberRoutes } from './routes/members';
import { notificationRoutes } from './routes/notifications';
import { boardRoutes } from './routes/boards';
import { savedFilterRoutes } from './routes/savedFilters';
import { searchRoutes } from './routes/search';
import { projectRoutes } from './routes/projects';
import { setupRoutes, type RateLimitOptions } from './routes/setup';
import { deliverableRoutes } from './routes/deliverables';
import { pinRoutes } from './routes/pins';
import { taskRoutes } from './routes/tasks';

export interface AppOptions {
  db: Db;
  /** Host data folder; uploaded files live in `<dataDir>/files`. */
  dataDir: string;
  logger?: boolean;
  /** Limit for sign-in / setup / change-password, per client IP. Tests lower it. */
  authRateLimit?: RateLimitOptions;
  /**
   * Who is connected, so a change can ping the people it concerns. One per Host; pass it in when
   * something outside the routes (the scheduled jobs) must reach the same people.
   */
  hub?: EventHub;
  /** Live board editing settings (tests shorten the storing delay). */
  collab?: CollabOptions;
}

export function buildApp({
  db,
  dataDir,
  logger = false,
  authRateLimit = { max: 10, timeWindow: '1 minute' },
  hub = new EventHub(),
  collab: collabOptions,
}: AppOptions): FastifyInstance {
  const app = Fastify({
    logger: logger && {
      serializers: {
        // File links carry their signature in the URL (routes/files.ts); keep it out of the log.
        req: (req: { method: string; url: string; ip: string }) => ({
          method: req.method,
          url: req.url.replace(/([?&]sig=)[^&]*/, '$1hidden'),
          remoteAddress: req.ip,
        }),
      },
    },
  });
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
  app.register(memberRoutes, { db, hub });
  app.register(fileRoutes, { db, dataDir });
  app.register(backupRoutes, { db, dataDir });
  app.register(notificationRoutes, { db });
  app.register(projectRoutes, { db, hub });
  app.register(boardRoutes, { db });
  app.register(searchRoutes, { db });
  app.register(savedFilterRoutes, { db });

  app.register(taskRoutes, { db, hub });
  app.register(deliverableRoutes, { db, hub });
  app.register(pinRoutes, { db });
  app.register(activityRoutes, { db, hub });
  app.register(hostSettingsRoutes, { db, dataDir });

  // Live connections share the one port: /collab (boards) and /events (notifications).
  const collab = createCollab(db, collabOptions);
  const closeEvents = routeUpgrades(app.server, {
    collab: collab.handleUpgrade,
    events: (socket) => onEventsConnection(socket, db, hub),
  });
  app.addHook('onClose', async () => {
    closeEvents();
    await collab.server.destroy();
  });
  return app;
}
