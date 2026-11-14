import { screen, waitFor } from '@testing-library/react';
import type { SessionUser, Task } from '@whiteboard/core';
import { http, HttpResponse, ws } from 'msw';
import { describe, expect, it } from 'vitest';

import { mockHost, OWNER, renderApp } from '../test/render';
import { server } from '../test/setup';

const MIA: SessionUser = { ...OWNER, id: 'u2', name: 'Mia', role: 'member' };
const events = ws.link(`${window.location.origin.replace(/^http/, 'ws')}/events`);

const task = (id: string, title: string): Task => ({
  id,
  projectId: 'p1',
  statusId: 's-todo',
  title,
  description: null,
  priority: 'medium',
  startAt: null,
  dueAt: null,
  sortKey: 1000,
  createdBy: 'u3',
  createdAt: 1,
  updatedAt: 1,
  assignees: [],
  subtaskCounts: { done: 0, total: 0 },
  fileCount: 0,
});

/** A project page whose task list the test can change, as another person would. */
function mockProjectPage(tasks: Task[]) {
  let listFetches = 0;
  server.use(
    http.get('*/projects/p1/statuses', () =>
      HttpResponse.json([{ id: 's-todo', name: 'To do', kind: 'todo', sortKey: 1000 }]),
    ),
    http.get('*/projects/p1/tasks', () => {
      listFetches++;
      return HttpResponse.json(tasks);
    }),
    http.get('*/projects/p1/files', () => HttpResponse.json([])),
    http.get('*/people', () => HttpResponse.json([])),
    http.get('*/projects/p1', () =>
      HttpResponse.json({
        id: 'p1',
        name: 'Logo for Client X',
        clientName: null,
        status: 'active',
        startDate: null,
        deadline: null,
        budget: null,
        color: null,
        createdBy: 'u2',
        createdAt: 1,
        memberCount: 1,
        myRole: 'manager',
        brief: null,
        instructions: null,
        members: [],
      }),
    ),
  );
  return { fetches: () => listFetches };
}

describe('live task updates', () => {
  it("shows another person's new task without a reload", async () => {
    mockHost({}, MIA);
    const tasks = [task('t1', 'Wordmark')];
    mockProjectPage(tasks);
    let signedIn: (() => void) | null = null;
    const connected = new Promise<void>((resolve) => (signedIn = resolve));
    let pushChange = () => {};
    server.use(
      events.addEventListener('connection', ({ client }) => {
        client.addEventListener('message', () => {
          client.send(JSON.stringify({ type: 'ready' }));
          pushChange = () =>
            client.send(JSON.stringify({ type: 'task.changed', projectId: 'p1', taskId: 't2' }));
          signedIn?.();
        });
      }),
    );
    renderApp('/projects/p1', 'tok');
    expect(await screen.findByRole('button', { name: 'Wordmark' })).toBeInTheDocument();
    await connected;

    // Fred adds a task in another window; the Host tells this one.
    tasks.push(task('t2', 'Icon'));
    pushChange();
    expect(await screen.findByRole('button', { name: 'Icon' })).toBeInTheDocument();
  });

  it('says it is reconnecting when the Host goes away, and catches up when it is back', async () => {
    mockHost({}, MIA);
    const page = mockProjectPage([task('t1', 'Wordmark')]);
    let connections = 0;
    let signedIn: (() => void) | null = null;
    const connected = new Promise<void>((resolve) => (signedIn = resolve));
    let restartHost = () => {};
    server.use(
      events.addEventListener('connection', ({ client }) => {
        connections++;
        client.addEventListener('message', () => {
          client.send(JSON.stringify({ type: 'ready' }));
          restartHost = () => client.close();
          signedIn?.();
        });
      }),
    );
    renderApp('/projects/p1', 'tok');
    await screen.findByRole('button', { name: 'Wordmark' });
    await connected;
    restartHost();
    expect(await screen.findByRole('status')).toHaveTextContent('Reconnecting to the Host');
    const before = page.fetches();

    // The app tries again after 1 s and, once back, refreshes what is on screen.
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(connections).toBe(2);
    await waitFor(() => expect(page.fetches()).toBeGreaterThan(before));
  });
});
