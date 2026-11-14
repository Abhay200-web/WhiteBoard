import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Notification, SessionUser } from '@whiteboard/core';
import { http, HttpResponse, ws } from 'msw';
import { describe, expect, it } from 'vitest';

import { mockHost, OWNER, renderApp } from '../test/render';
import { server } from '../test/setup';

const FRED: SessionUser = { ...OWNER, id: 'u3', name: 'Fred', role: 'guest' };

const note = (over: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  kind: 'assigned',
  actorName: 'Mia',
  projectId: 'p1',
  projectName: 'Logo for Client X',
  taskId: 't1',
  taskTitle: 'Logo concepts',
  detail: null,
  createdAt: Date.now(),
  readAt: null,
  ...over,
});

describe('notification bell', () => {
  it('lists notifications as sentences; clicking one marks it read and opens its task', async () => {
    mockHost({}, FRED);
    const read: unknown[] = [];
    server.use(
      http.get('*/notifications', () =>
        HttpResponse.json({
          unread: 2,
          items: [
            note(),
            note({ id: 'n2', kind: 'mentioned', actorName: 'Mia', detail: 'Ready, @Fred?' }),
            note({
              id: 'n3',
              kind: 'added_to_project',
              taskId: null,
              taskTitle: null,
              readAt: 1,
            }),
          ],
        }),
      ),
      http.post('*/notifications/read', async ({ request }) => {
        read.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
      http.get('*/projects/p1', () =>
        HttpResponse.json({ error: 'not_found', message: 'x' }, { status: 404 }),
      ),
    );
    const user = userEvent.setup();
    const { router } = renderApp('/', 'tok');
    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    const panel = screen.getByRole('region', { name: 'Notifications' });
    const lines = within(panel)
      .getAllByRole('button')
      .filter((b) => b.textContent !== 'Mark all read')
      .map((b) => b.textContent?.split('Logo for Client X ·')[0]);
    expect(lines).toEqual([
      'Unread: Mia assigned you Logo concepts',
      'Unread: Mia mentioned you on Logo concepts: “Ready, @Fred?”',
      'Mia added you to Logo for Client X',
    ]);

    await user.click(within(panel).getByRole('button', { name: /assigned you/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?task=t1'));
    expect(router.state.location.pathname).toBe('/projects/p1');
    expect(read).toEqual([{ ids: ['n1'] }]);
    expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument();
  });

  it('marks everything read', async () => {
    mockHost({}, FRED);
    let unread = 1;
    server.use(
      http.get('*/notifications', () =>
        HttpResponse.json({ unread, items: unread ? [note()] : [] }),
      ),
      http.post('*/notifications/read', async ({ request }) => {
        expect(await request.json()).toEqual({});
        unread = 0;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/', 'tok');
    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(await screen.findByText('You are all caught up.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('updates live: signs in on the connection, then refreshes on every ping', async () => {
    mockHost({}, FRED);
    let unread = 0;
    const sent: string[] = [];
    const events = ws.link(`${window.location.origin.replace(/^http/, 'ws')}/events`);
    server.use(
      http.get('*/notifications', () =>
        HttpResponse.json({ unread, items: unread ? [note()] : [] }),
      ),
      events.addEventListener('connection', ({ client }) => {
        client.addEventListener('message', (event) => {
          sent.push(String(event.data));
          client.send(JSON.stringify({ type: 'ready' }));
          // Someone assigns Fred a task a moment later.
          setTimeout(() => {
            unread = 1;
            client.send(JSON.stringify({ type: 'notification' }));
          }, 20);
        });
      }),
    );
    renderApp('/', 'tok');
    expect(
      await screen.findByRole('button', { name: 'Notifications, 1 unread' }),
    ).toBeInTheDocument();
    expect(sent).toEqual([JSON.stringify({ type: 'auth', token: 'tok' })]);
  });
});
