import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionUser, TaskStatus } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { mockHost, OWNER, renderApp } from '../../test/render';
import { server } from '../../test/setup';

const MEMBER: SessionUser = {
  ...OWNER,
  id: 'u2',
  email: 'mia@studio.test',
  name: 'Mia',
  role: 'member',
};

const project = (myRole: 'manager' | 'artist') => ({
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
  myRole,
  brief: null,
  instructions: null,
  members: [{ userId: 'u2', name: 'Mia', email: 'mia@studio.test', role: myRole }],
});

const START: TaskStatus[] = [
  { id: 's1', name: 'To do', kind: 'todo', sortKey: 1000 },
  { id: 's2', name: 'In progress', kind: 'doing', sortKey: 2000 },
];

function mockStatuses(myRole: 'manager' | 'artist') {
  let list = [...START];
  const sent: { method: string; url: string; body: unknown }[] = [];
  const answer = async ({ request }: { request: Request }) => {
    const body = request.method === 'DELETE' ? null : await request.json();
    sent.push({ method: request.method, url: new URL(request.url).pathname, body });
    if (request.method === 'DELETE') {
      return HttpResponse.json(
        {
          error: 'last_of_kind',
          message: 'The project needs at least one status that behaves like To do',
        },
        { status: 409 },
      );
    }
    if (request.method === 'POST') {
      const { name, kind } = body as { name: string; kind: TaskStatus['kind'] };
      list = [...list, { id: 's3', name, kind, sortKey: 3000 }];
    }
    if (request.method === 'PUT') {
      const { ids } = body as { ids: string[] };
      list = ids.map((id) => list.find((s) => s.id === id)!);
    }
    return HttpResponse.json(list, { status: request.method === 'POST' ? 201 : 200 });
  };
  server.use(
    http.get('*/projects/p1', () => HttpResponse.json(project(myRole))),
    http.get('*/projects/p1/files', () => HttpResponse.json([])),
    http.get('*/projects/p1/tasks', () => HttpResponse.json([])),
    http.get('*/people', () => HttpResponse.json([])),
    http.get('*/projects/p1/statuses', () => HttpResponse.json(list)),
    http.post('*/projects/p1/statuses', answer),
    http.put('*/projects/p1/statuses/order', answer),
    http.delete('*/projects/p1/statuses/:id', answer),
  );
  return sent;
}

describe('task statuses card', () => {
  it('lets a manager add a status, move it up, and see why a delete is refused', async () => {
    mockHost({}, MEMBER);
    const sent = mockStatuses('manager');
    const user = userEvent.setup();
    renderApp('/projects/p1', 'tok');

    const list = await screen.findByRole('list', { name: 'Task statuses' });
    expect(await within(list).findByText('· behaves like In progress')).toBeInTheDocument();

    await user.type(screen.getByLabelText('New status'), 'Waiting on client');
    await user.selectOptions(screen.getByLabelText('Behaves like'), 'In progress');
    await user.click(screen.getByRole('button', { name: 'Add status' }));
    expect(await within(list).findByText('Waiting on client')).toBeInTheDocument();
    expect(sent[0]).toMatchObject({
      method: 'POST',
      body: { name: 'Waiting on client', kind: 'doing' },
    });

    await user.click(screen.getByRole('button', { name: 'Move Waiting on client up' }));
    await waitFor(() =>
      expect(sent[1]).toMatchObject({ method: 'PUT', body: { ids: ['s1', 's3', 's2'] } }),
    );

    await user.click(screen.getByRole('button', { name: 'Delete To do' }));
    expect(
      await screen.findByText('The project needs at least one status that behaves like To do'),
    ).toBeInTheDocument();
    expect(sent[2]).toMatchObject({ method: 'DELETE', url: '/projects/p1/statuses/s1' });
  });

  it('is not shown to an artist', async () => {
    mockHost({}, MEMBER);
    mockStatuses('artist');
    renderApp('/projects/p1', 'tok');
    expect(await screen.findByRole('heading', { name: 'Logo for Client X' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Task statuses' })).not.toBeInTheDocument();
  });
});
