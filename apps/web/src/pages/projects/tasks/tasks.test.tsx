import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionUser, Task, TaskStatus } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { mockHost, OWNER, renderApp } from '../../../test/render';
import { server } from '../../../test/setup';

const MIA: SessionUser = {
  ...OWNER,
  id: 'u2',
  email: 'mia@studio.test',
  name: 'Mia',
  role: 'member',
};
const FRED: SessionUser = {
  ...OWNER,
  id: 'u3',
  email: 'fred@free.test',
  name: 'Fred',
  role: 'guest',
};

const MEMBERS = [
  { userId: 'u2', name: 'Mia', email: 'mia@studio.test', role: 'manager' },
  { userId: 'u3', name: 'Fred', email: 'fred@free.test', role: 'artist' },
];

const STATUSES: TaskStatus[] = [
  ['todo', 'To do'],
  ['doing', 'In progress'],
  ['review', 'In review'],
  ['changes', 'Changes requested'],
  ['approved', 'Approved'],
  ['done', 'Done'],
].map(
  ([kind, name], i) => ({ id: `s-${kind}`, kind, name, sortKey: (i + 1) * 1000 }) as TaskStatus,
);

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  projectId: 'p1',
  statusId: 's-todo',
  title: 'Logo concepts',
  description: null,
  priority: 'medium',
  startAt: null,
  dueAt: null,
  sortKey: 1000,
  createdBy: 'u2',
  createdAt: 1,
  updatedAt: 1,
  assignees: [],
  subtaskCounts: { done: 0, total: 0 },
  fileCount: 0,
  ...over,
});

/** A small in-memory Host for one project. Returns what the app sent, for assertions. */
function mockProject(myRole: 'manager' | 'artist', tasks: Task[]) {
  const sent: { method: string; url: string; body: unknown }[] = [];
  let subtasks: { id: string; taskId: string; title: string; done: boolean; sortKey: number }[] =
    [];
  const record = async (request: Request) => {
    const body = request.method === 'GET' ? null : await request.json().catch(() => null);
    sent.push({ method: request.method, url: new URL(request.url).pathname, body });
    return body as Record<string, unknown>;
  };
  server.use(
    http.get('*/projects/p1/statuses', () => HttpResponse.json(STATUSES)),
    http.get('*/projects/p1/tasks', () => HttpResponse.json(tasks)),
    http.post('*/projects/p1/tasks', async ({ request }) => {
      const body = await record(request);
      tasks = [...tasks, task({ id: `t${tasks.length + 1}`, title: String(body.title) })];
      return HttpResponse.json(tasks.at(-1), { status: 201 });
    }),
    http.get('*/projects/p1/files', () => HttpResponse.json([])),
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
        myRole,
        brief: null,
        instructions: null,
        members: MEMBERS,
      }),
    ),
    http.get('*/people', () => HttpResponse.json([])),
    http.get('*/tasks/:id/subtasks', () => HttpResponse.json(subtasks)),
    http.post('*/tasks/:id/subtasks', async ({ request, params }) => {
      const body = await record(request);
      subtasks = [
        ...subtasks,
        {
          id: `st${subtasks.length + 1}`,
          taskId: String(params.id),
          title: String(body.title),
          done: false,
          sortKey: 1,
        },
      ];
      return HttpResponse.json(subtasks, { status: 201 });
    }),
    http.patch('*/subtasks/:id', async ({ request, params }) => {
      const body = await record(request);
      subtasks = subtasks.map((s) => (s.id === params.id ? { ...s, ...body } : s));
      return HttpResponse.json(subtasks);
    }),
    http.get('*/tasks/:id/files', () => HttpResponse.json([])),
    http.patch('*/tasks/:id', async ({ request, params }) => {
      const body = await record(request);
      tasks = tasks.map((t) => (t.id === params.id ? { ...t, ...body } : t));
      return HttpResponse.json(tasks.find((t) => t.id === params.id));
    }),
    http.put('*/tasks/:id/assignees', async ({ request, params }) => {
      const body = (await record(request)) as { userIds: string[] };
      const assignees = MEMBERS.filter((m) => body.userIds.includes(m.userId)).map(
        ({ userId, name }) => ({ userId, name }),
      );
      tasks = tasks.map((t) => (t.id === params.id ? { ...t, assignees } : t));
      return HttpResponse.json(tasks.find((t) => t.id === params.id));
    }),
  );
  return sent;
}

const drawer = () => screen.findByRole('dialog');

describe('task list', () => {
  it('groups tasks by status, sorts them, and lets the manager add one', async () => {
    mockHost({}, MIA);
    const sent = mockProject('manager', [
      task({ id: 't1', title: 'Wordmark', priority: 'low', sortKey: 1000 }),
      task({ id: 't2', title: 'Icon', priority: 'urgent', sortKey: 2000 }),
      task({ id: 't3', title: 'Kick-off', statusId: 's-done' }),
    ]);
    const user = userEvent.setup();
    renderApp('/projects/p1', 'tok');

    const todo = await screen.findByRole('region', { name: 'To do' });
    const titles = () =>
      within(todo)
        .getAllByRole('button')
        .map((b) => b.textContent);
    expect(titles()).toEqual(['Wordmark', 'Icon']);
    expect(screen.getByRole('region', { name: 'Done' })).toHaveTextContent('Kick-off');
    expect(screen.queryByRole('region', { name: 'In progress' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Sort tasks'), 'priority');
    expect(titles()).toEqual(['Icon', 'Wordmark']);

    await user.type(screen.getByLabelText('New task title'), 'Logo concepts');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await within(todo).findByText('Logo concepts')).toBeInTheDocument();
    expect(sent).toContainEqual(
      expect.objectContaining({ method: 'POST', body: { title: 'Logo concepts' } }),
    );

    // The new task opens straight away, without a reload.
    await user.click(within(todo).getByRole('button', { name: 'Logo concepts' }));
    expect(within(await drawer()).getByLabelText('Title')).toHaveValue('Logo concepts');
  });
});

describe('task drawer', () => {
  it('lets the manager edit the title, status, assignees and checklist', async () => {
    mockHost({}, MIA);
    const sent = mockProject('manager', [task()]);
    const user = userEvent.setup();
    renderApp('/projects/p1', 'tok');
    await user.click(await screen.findByRole('button', { name: 'Logo concepts' }));
    const panel = await drawer();

    const title = within(panel).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Logo concepts v2');
    await user.tab();
    expect(
      await within(panel).findByRole('heading', { name: 'Logo concepts v2' }),
    ).toBeInTheDocument();

    const status = within(panel).getByLabelText('Status');
    // Managers may skip ahead, but nobody moves a task into review by hand.
    expect(within(status).queryByRole('option', { name: 'In review' })).not.toBeInTheDocument();
    await user.selectOptions(status, 'Approved');
    await waitFor(() => expect(status).toHaveValue('s-approved'));

    await user.click(within(panel).getByRole('checkbox', { name: 'Fred' }));
    await waitFor(() =>
      expect(within(panel).getByRole('checkbox', { name: 'Fred' })).toBeChecked(),
    );

    await user.type(within(panel).getByLabelText('New checklist item'), 'Sketch');
    await user.click(within(panel).getByRole('button', { name: 'Add' }));
    expect(await within(panel).findByRole('checkbox', { name: 'Sketch' })).toBeInTheDocument();

    expect(sent.map((s) => [s.method, s.url, s.body])).toEqual([
      ['PATCH', '/tasks/t1', { title: 'Logo concepts v2' }],
      ['PATCH', '/tasks/t1', { statusId: 's-approved' }],
      ['PUT', '/tasks/t1/assignees', { userIds: ['u3'] }],
      ['POST', '/tasks/t1/subtasks', { title: 'Sketch' }],
    ]);
  });

  it('shows an assignee only the moves they may make, and lets them tick the checklist', async () => {
    mockHost({}, FRED);
    const sent = mockProject('artist', [task({ assignees: [{ userId: 'u3', name: 'Fred' }] })]);
    server.use(
      http.get('*/tasks/:id/subtasks', () =>
        HttpResponse.json([{ id: 'st1', taskId: 't1', title: 'Sketch', done: false, sortKey: 1 }]),
      ),
    );
    const user = userEvent.setup();
    renderApp('/projects/p1', 'tok');
    expect(await screen.findByRole('region', { name: 'To do' })).toBeInTheDocument();
    expect(screen.queryByLabelText('New task title')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Logo concepts' }));
    const panel = await drawer();
    expect(within(panel).queryByLabelText('Title')).not.toBeInTheDocument();
    expect(within(panel).getByLabelText('Priority')).toBeDisabled();
    expect(within(panel).getByRole('checkbox', { name: 'Fred' })).toBeDisabled();
    expect(within(panel).queryByRole('button', { name: 'Delete task' })).not.toBeInTheDocument();
    const status = within(panel).getByLabelText('Status');
    expect(
      within(status)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['To do', 'In progress']);

    await user.selectOptions(status, 'In progress');
    await user.click(await within(panel).findByRole('checkbox', { name: 'Sketch' }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent.map((s) => s.body)).toEqual([{ statusId: 's-doing' }, { done: true }]);
  });

  it('puts the status back and explains when the Host refuses a move', async () => {
    mockHost({}, MIA);
    mockProject('manager', [task()]);
    server.use(
      http.patch('*/tasks/:id', () =>
        HttpResponse.json(
          { error: 'forbidden', message: 'You cannot move this task to Done' },
          { status: 403 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp('/projects/p1', 'tok');
    await user.click(await screen.findByRole('button', { name: 'Logo concepts' }));
    const panel = await drawer();
    const status = within(panel).getByLabelText('Status');
    await user.selectOptions(status, 'Done');
    expect(await within(panel).findByText('You cannot move this task to Done')).toBeInTheDocument();
    await waitFor(() => expect(status).toHaveValue('s-todo'));
  });
});
