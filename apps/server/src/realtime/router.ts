import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type WebSocket } from 'ws';

/**
 * The Host has one HTTP port, and every WebSocket upgrade comes through this one listener, which
 * sends it to the right handler by path:
 *   /collab  -> board editing (Hocuspocus)
 *   /events  -> live notifications (plain `ws`)
 * Anything else is refused. `@fastify/websocket` is not used: it clashes with Hocuspocus on one
 * port (docs/adr/0003-realtime-boards.md).
 */
export function routeUpgrades(
  http: HttpServer,
  handlers: {
    collab: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
    events: (socket: WebSocket) => void;
  },
) {
  const eventsServer = new WebSocketServer({ noServer: true });
  http.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname === '/collab') return handlers.collab(req, socket, head);
    if (pathname === '/events') {
      return eventsServer.handleUpgrade(req, socket, head, (ws) => handlers.events(ws));
    }
    socket.destroy();
  });
  return () => eventsServer.close();
}
