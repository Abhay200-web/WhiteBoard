import type { ServerEvent } from '@whiteboard/core';

/** The little of a WebSocket the hub uses. */
export interface LiveSocket {
  readonly readyState: number;
  send(data: string): void;
  on(event: 'close', listener: () => void): void;
}

const OPEN = 1;

/** Who has the app open: user id -> their live `/events` connections (one per window). */
export class EventHub {
  private readonly sockets = new Map<string, Set<LiveSocket>>();

  add(userId: string, socket: LiveSocket): void {
    const mine = this.sockets.get(userId) ?? new Set<LiveSocket>();
    mine.add(socket);
    this.sockets.set(userId, mine);
    socket.on('close', () => {
      mine.delete(socket);
      if (mine.size === 0) this.sockets.delete(userId);
    });
  }

  /** Everyone with the app open right now. */
  connectedUsers(): string[] {
    return [...this.sockets.keys()];
  }

  /** Sends to every open window of these people; anyone offline sees it on their next visit. */
  send(userIds: Iterable<string>, event: ServerEvent): void {
    const message = JSON.stringify(event);
    for (const id of new Set(userIds)) {
      for (const socket of this.sockets.get(id) ?? []) {
        if (socket.readyState === OPEN) socket.send(message);
      }
    }
  }
}
