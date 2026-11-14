import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MyTask, SessionUser } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { mockHost, OWNER, renderApp } from '../../test/render';
import { server } from '../../test/setup';
import { dueGroup } from './TaskInbox';

const FRED: SessionUser = {
  ...OWNER,
  id: 'u3',
  email: 'fred@free.test',
  name: 'Fred',
  role: 'guest',
};
const DAY = 86_400_000;

const myTask = (over: Partial<MyTask> = {}): MyTask => ({
  id: 't1',
  projectId: 'p1',
  statusId: 's-todo',
  title: 'Logo concepts',
  description: null,
  priority: 'high',
  startAt: null,
  dueAt: null,
  sortKey: 1000,
  createdBy: 'u2',
  createdAt: 1,
  updatedAt: 1,
  assignees: [{ userId: 'u3', name: 'Fred' }],
  subtaskCounts: { done: 0, total: 0 },
  fileCount: 0,
  projectName: 'Logo for Client X',
  statusName: 'To do',
  ...over,
});

describe('due groups', () => {
  it('sorts due dates into Overdue, Today, This week and Later by the local clock', () => {
    const now = new Date('2027-03-10T15:00:00');
    const at = (s: string) => new Date(s).getTime();
    expect(dueGroup(at('2027-03-10T09:00:00'), now)).toBe('Overdue');
    expect(dueGroup(at('2027-03-10T23:59:00'), now)).toBe('Today');
    expect(dueGroup(at('2027-03-11T08:00:00'), now)).toBe('This week');
    expect(dueGroup(at('2027-03-16T23:00:00'), now)).toBe('This week'); // today + 6 days
    expect(dueGroup(at('2027-03-17T09:00:00'), now)).toBe('Later');
    expect(dueGroup(null, now)).toBe('Later');
  });
});

describe('My tasks page', () => {
  it('groups my tasks from every project and opens one in the task drawer', async () => {
    mockHost({}, FRED);
    const overdue = myTask({ id: 't1', title: 'Logo concepts', dueAt: Date.now() - DAY });
    server.use(
      http.get('*/me/tasks', () =>
        HttpResponse.json([
          overdue,
          myTask({
            id: 't2',
            title: 'Box design',
            projectId: 'p2',
            projectName: 'Packaging',
            dueAt: Date.now() + 3 * DAY,
          }),
          myTask({ id: 't3', title: 'Moodboard', dueAt: null }),
        ]),
      ),
      // What the drawer loads for the task's project.
      http.get('*/projects/p1/statuses', () =>
        HttpResponse.json([
          { id: 's-todo', name: 'To do', kind: 'todo', sortKey: 1000 },
          { id: 's-doing', name: 'In progress', kind: 'doing', sortKey: 2000 },
        ]),
      ),
      http.get('*/projects/p1/tasks', () => HttpResponse.json([overdue])),
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
          memberCount: 2,
          myRole: 'artist',
          brief: null,
          instructions: null,
          members: [{ userId: 'u3', name: 'Fred', email: 'fred@free.test', role: 'artist' }],
        }),
      ),
      http.get('*/tasks/:id/subtasks', () => HttpResponse.json([])),
      http.get('*/tasks/:id/files', () => HttpResponse.json([])),
      http.get('*/tasks/:id/comments', () => HttpResponse.json([])),
      http.get('*/tasks/:id/history', () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderApp('/', 'tok');
    await user.click(await screen.findByRole('link', { name: 'My tasks' }));
    // Freelancers never manage a project, so they get no review queue.
    expect(screen.queryByRole('link', { name: 'Review queue' })).not.toBeInTheDocument();

    const late = await screen.findByRole('region', { name: 'Overdue' });
    expect(late).toHaveTextContent('Logo concepts');
    expect(late).toHaveTextContent('Logo for Client X · To do');
    expect(screen.getByRole('region', { name: 'This week' })).toHaveTextContent('Packaging');
    expect(screen.getByRole('region', { name: 'Later' })).toHaveTextContent('Moodboard');
    expect(screen.queryByRole('region', { name: 'Today' })).not.toBeInTheDocument();

    await user.click(within(late).getByRole('button', { name: 'Logo concepts' }));
    const drawer = await screen.findByRole('dialog', { name: 'Logo concepts' });
    expect(within(drawer).getByLabelText('Status')).toHaveValue('s-todo');
  });

  it('says so when nothing is assigned, and shows staff the review queue', async () => {
    mockHost({}, { ...FRED, role: 'member' });
    server.use(
      http.get('*/me/tasks', () => HttpResponse.json([])),
      http.get('*/me/review-queue', () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    renderApp('/my-tasks', 'tok');
    expect(await screen.findByText('Nothing is assigned to you right now.')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Review queue' }));
    expect(await screen.findByText('Nothing is waiting for your review.')).toBeInTheDocument();
  });
});
