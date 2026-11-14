import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { serverEventSchema } from '@whiteboard/core';
import { useEffect, useState } from 'react';

import { getHostUrl, getToken } from './api';

/** The Host's `/events` address: same origin in dev (the dev server forwards it), else the Host. */
function eventsUrl(): string {
  const base = getHostUrl() || window.location.origin;
  return `${base.replace(/^http/, 'ws')}/events`;
}

const NOT_SIGNED_IN = 4401;

/** `reconnecting`: the connection was up and dropped; the app is trying to get it back. */
export type LiveStatus = 'connecting' | 'online' | 'reconnecting';

/** A task changed somewhere: reload everything on screen that shows it (only what is open). */
function reloadTask(queryClient: QueryClient, projectId: string, taskId: string) {
  for (const queryKey of [
    ['tasks', projectId],
    ['subtasks', taskId],
    ['comments', taskId],
    ['history', taskId],
    ['files', `/tasks/${taskId}/files`],
    ['me'], // My tasks and the review queue
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * Keeps one live connection to the Host while signed in.
 * - A notification ping refreshes the bell; a `task.changed` reloads that task wherever shown.
 * - If the connection drops (Host restarted, network), it reconnects after 1 s, 2 s, 4 s ... up
 *   to 30 s. Once back, everything on screen is refreshed, since anything may have changed.
 */
export function useLiveEvents(signedIn: boolean): LiveStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');

  useEffect(() => {
    if (!signedIn) return;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let wasOnline = false;
    let stopped = false;

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
        switch (event.data.type) {
          case 'ready':
            attempt = 0;
            setStatus('online');
            // Back after a drop: refresh everything. First time: just catch up on the bell.
            void queryClient.invalidateQueries(
              wasOnline ? undefined : { queryKey: ['notifications'] },
            );
            wasOnline = true;
            break;
          case 'notification':
            void queryClient.invalidateQueries({ queryKey: ['notifications'] });
            break;
          case 'task.changed':
            reloadTask(queryClient, event.data.projectId, event.data.taskId);
            break;
        }
      };
      socket.onclose = (closed) => {
        if (stopped || closed.code === NOT_SIGNED_IN) return;
        if (wasOnline) setStatus('reconnecting');
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

  return status;
}
