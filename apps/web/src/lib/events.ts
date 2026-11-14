import { useQueryClient } from '@tanstack/react-query';
import { serverEventSchema } from '@whiteboard/core';
import { useEffect } from 'react';

import { getHostUrl, getToken } from './api';

/** The Host's `/events` address: same origin in dev (the dev server forwards it), else the Host. */
function eventsUrl(): string {
  const base = getHostUrl() || window.location.origin;
  return `${base.replace(/^http/, 'ws')}/events`;
}

const NOT_SIGNED_IN = 4401;

/**
 * Keeps one live connection to the Host while signed in. Each ping refreshes the bell. If the
 * connection drops (Host restarted, network), it reconnects after 1 s, 2 s, 4 s ... up to 30 s,
 * and refreshes once connected again, so nothing sent meanwhile is missed.
 */
export function useLiveEvents(signedIn: boolean): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!signedIn) return;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ['notifications'] });

    function connect() {
      const token = getToken();
      if (!token || stopped) return;
      socket = new WebSocket(eventsUrl());
      socket.onopen = () => socket?.send(JSON.stringify({ type: 'auth', token }));
      socket.onmessage = (message) => {
        let data: unknown;
        try {
          data = JSON.parse(String(message.data));
        } catch {
          return;
        }
        const event = serverEventSchema.safeParse(data);
        if (!event.success) return;
        if (event.data.type === 'ready') attempt = 0;
        refresh(); // 'ready' (caught up after a reconnect) or 'notification'
      };
      socket.onclose = (closed) => {
        if (stopped || closed.code === NOT_SIGNED_IN) return;
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [signedIn, queryClient]);
}
