import { clientEventSchema } from '@whiteboard/core';
import type { Db } from '@whiteboard/db';
import type { WebSocket } from 'ws';

import { resolveSession } from '../auth/sessions';
import type { EventHub } from '../events/hub';

/** Close code for "not signed in" (4000-4999 are free for apps). */
const UNAUTHORIZED = 4401;

/**
 * `/events`: the live connection the app keeps open. The sign-in token arrives as the first
 * message rather than in the URL, so it never appears in a log. Until then nothing is sent.
 * Called by the upgrade router (realtime/router.ts) for each new connection.
 */
export function onEventsConnection(socket: WebSocket, db: Db, hub: EventHub) {
  const giveUp = setTimeout(() => socket.close(UNAUTHORIZED, 'Sign in required'), 10_000);
  socket.once('message', (raw) => {
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
}
