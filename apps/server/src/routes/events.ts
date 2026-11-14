import { clientEventSchema } from '@whiteboard/core';
import type { Db } from '@whiteboard/db';
import type { FastifyPluginAsync } from 'fastify';

import { resolveSession } from '../auth/sessions';
import type { EventHub } from '../events/hub';

/** Close code for "not signed in" (4000-4999 are free for apps). */
const UNAUTHORIZED = 4401;

/**
 * `/events`: the live connection the app keeps open. The sign-in token arrives as the first
 * message rather than in the URL, so it never appears in a log. Until then nothing is sent.
 * Needs `@fastify/websocket` registered on the app (see app.ts).
 */
export const eventRoutes: FastifyPluginAsync<{ db: Db; hub: EventHub }> = async (
  app,
  { db, hub },
) => {
  app.get('/events', { websocket: true }, (socket) => {
    const giveUp = setTimeout(() => socket.close(UNAUTHORIZED, 'Sign in required'), 10_000);
    socket.once('message', (raw: { toString(): string }) => {
      clearTimeout(giveUp);
      let message: unknown = null;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        // not JSON: treated as no sign-in below
      }
      const parsed = clientEventSchema.safeParse(message);
      const auth = parsed.success ? resolveSession(db, parsed.data.token) : null;
      if (!auth) return socket.close(UNAUTHORIZED, 'Sign in required');
      hub.add(auth.user.id, socket);
      socket.send(JSON.stringify({ type: 'ready' }));
    });
  });
};
