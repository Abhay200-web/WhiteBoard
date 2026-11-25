import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { Notification } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useDesktopNotifications } from './desktopNotifications';
import { fakeDesktop } from '../test/desktop';
import { server } from '../test/setup';

const note = (over: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  kind: 'assigned',
  actorName: 'Mia',
  projectId: 'p1',
  projectName: 'Logo for Client X',
  taskId: 't1',
  taskTitle: 'Logo concepts',
  detail: null,
  createdAt: 1,
  readAt: null,
  ...over,
});

/** Serves `items` as the inbox; returns a setter to change them. */
function inbox(items: Notification[]) {
  let current = items;
  server.use(
    http.get('*/notifications', () =>
      HttpResponse.json({
        unread: current.filter((n) => n.readAt === null).length,
        items: current,
      }),
    ),
  );
  return (next: Notification[]) => {
    current = next;
  };
}

/** Runs the hook for user u1 with a fresh query client; call after setting up the bridge. */
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  renderHook(() => useDesktopNotifications('u1'), { wrapper });
  return client;
}

describe('desktop notifications', () => {
  it('does not replay what was already in the inbox the first time', async () => {
    inbox([note()]);
    const bridge = fakeDesktop('client');
    const client = mount();

    await waitFor(() => expect(client.getQueryData(['notifications'])).toBeDefined());
    expect(bridge.notify).not.toHaveBeenCalled();
    expect(localStorage.getItem('whiteboard.desktopNotified.u1')).toBe('["n1"]');
  });

  it('shows each new unread notification once, as a sentence and the project name', async () => {
    const setItems = inbox([note({ id: 'old' })]);
    const bridge = fakeDesktop('client');
    const client = mount();
    await waitFor(() => expect(client.getQueryData(['notifications'])).toBeDefined());

    setItems([
      note({ id: 'new', taskTitle: 'Moodboard' }),
      note({ id: 'read', readAt: 2 }),
      note({ id: 'old' }),
    ]);
    await client.refetchQueries({ queryKey: ['notifications'] });
    await waitFor(() => expect(bridge.notify).toHaveBeenCalledTimes(1));

    expect(bridge.notify).toHaveBeenCalledWith(
      'Whiteboard · Logo for Client X',
      'Mia assigned you Moodboard',
    );
    // The same inbox again (a refetch) shows nothing new.
    await client.refetchQueries({ queryKey: ['notifications'] });
    expect(bridge.notify).toHaveBeenCalledTimes(1);
  });

  it('does not fetch the inbox in a browser', async () => {
    inbox([note({ id: 'new' })]);
    const client = mount();

    // Give a fetch the chance to start; the query is disabled without the desktop app.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.getQueryData(['notifications'])).toBeUndefined();
    expect(localStorage.getItem('whiteboard.desktopNotified.u1')).toBeNull();
  });
});
