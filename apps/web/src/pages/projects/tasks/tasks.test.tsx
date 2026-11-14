import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Comment, SessionUser, Task, TaskHistoryEntry, TaskStatus } from '@whiteboard/core';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

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
function mockProject(
  myRole: 'manager' | 'artist',
  tasks: Task[],
  { comments = [] as Comment[], history = [] as TaskHistoryEntry[] } = {},
) {
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
    http.get('*/tasks/:id/history', () => HttpResponse.json(history)),
    http.get('*/tasks/:id/comments', () => HttpResponse.json(comments)),
    http.post('*/tasks/:id/comments', async ({ request, params }) => {
      const body = (await record(request)) as { body: string; mentionIds: string[] };
      const me = myRole === 'manager' ? MEMBERS[0]! : MEMBERS[1]!;
      comments = [
        ...comments,
        {
          id: `c${comments.length + 1}`,
          taskId: String(params.id),
          authorId: me.userId,
          authorName: me.name,
          body: body.body,
          mentions: body.mentionIds,
          createdAt: Date.now(),
          editedAt: null,
        },
      ];
      return HttpResponse.json(comments, { status: 201 });
    }),
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

describe('task board', () => {
  /** Drags the card titled `title` and drops it on `target` (a column or another card). */
  function dragCard(title: string, target: Element) {
    const card = screen.getByRole('button', { name: title }).closest('article')!;
    fireEvent.dragStart(card);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
  }
  const column = (name: string) => screen.getByRole('region', { name });
  const cardsIn = (name: string) =>
    within(column(name))
      .queryAllByRole('button')
      .map((b) => b.textContent);

  async function openBoard() {
    const user = userEvent.setup();
    renderApp('/projects/p1', 'tok');
    await user.click(await screen.findByRole('button', { name: 'Board' }));
    await screen.findByRole('region', { name: 'Approved' }); // every column shows, even empty
  }

  it('moves a card to another column, and reorders cards inside one', async () => {
    mockHost({}, MIA);
    const sent = mockProject('manager', [
      task({ id: 't1', title: 'Wordmark', sortKey: 1000 }),
      task({ id: 't2', title: 'Icon', sortKey: 2000 }),
    ]);
    await openBoard();

    dragCard('Icon', screen.getByRole('button', { name: 'Wordmark' }).closest('article')!);
    await waitFor(() => expect(cardsIn('To do')).toEqual(['Icon', 'Wordmark']));

    dragCard('Wordmark', column('In progress'));
    await waitFor(() => expect(cardsIn('In progress')).toEqual(['Wordmark']));
    expect(sent.map((s) => s.body)).toEqual([
      { sortKey: 0 },
      { sortKey: 1000, statusId: 's-doing' },
    ]);
  });

  it('lets an assignee drop only where the rules allow', async () => {
    mockHost({}, FRED);
    const sent = mockProject('artist', [task({ assignees: [{ userId: 'u3', name: 'Fred' }] })]);
    await openBoard();
    dragCard('Logo concepts', column('Approved'));
    expect(cardsIn('Approved')).toEqual([]);
    dragCard('Logo concepts', column('In progress'));
    await waitFor(() => expect(cardsIn('In progress')).toEqual(['Logo concepts']));
    expect(sent.map((s) => s.body)).toEqual([{ sortKey: 1000, statusId: 's-doing' }]);
  });

  it('puts the card back and explains when the Host refuses the move', async () => {
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
    await openBoard();
    dragCard('Logo concepts', column('Done'));
    expect(await screen.findByText('You cannot move this task to Done')).toBeInTheDocument();
    expect(cardsIn('To do')).toEqual(['Logo concepts']);
    expect(cardsIn('Done')).toEqual([]);
  });

  it('keeps an accepted move when an earlier, slower one is refused', async () => {
    mockHost({}, MIA);
    mockProject('manager', [
      task({ id: 't1', title: 'Wordmark', sortKey: 1000 }),
      task({ id: 't2', title: 'Icon', sortKey: 2000 }),
    ]);
    server.use(
      http.patch('*/tasks/t1', async () => {
        await delay(50);
        return HttpResponse.json({ error: 'forbidden', message: 'Refused' }, { status: 403 });
      }),
    );
    await openBoard();
    dragCard('Wordmark', column('Done'));
    dragCard('Icon', column('In progress'));
    // Wordmark's refused move goes back; Icon's accepted move stays.
    await waitFor(() => expect(cardsIn('To do')).toEqual(['Wordmark']));
    expect(cardsIn('Done')).toEqual([]);
    expect(cardsIn('In progress')).toEqual(['Icon']);
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

describe('task drawer: closing and refused edits', () => {
  async function openDrawer(tasks: Task[] = [task()]) {
    mockHost({}, MIA);
    const sent = mockProject('manager', tasks);
    const user = userEvent.setup();
    renderApp('/projects/p1', 'tok');
    await user.click(await screen.findByRole('button', { name: tasks[0]!.title }));
    return { sent, user, panel: await drawer() };
  }

  it('saves the title and description still being typed when Escape closes the drawer', async () => {
    const { sent, user, panel } = await openDrawer();
    await user.click(within(panel).getByRole('textbox', { name: 'Description' }));
    await user.keyboard('Three logo ideas');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(JSON.stringify(sent[0]!.body)).toContain('Three logo ideas');

    await user.click(screen.getByRole('button', { name: 'Logo concepts' }));
    const again = await drawer();
    const title = within(again).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Logo concepts v2{Escape}');
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.body).toEqual({ title: 'Logo concepts v2' });
  });

  it('closes only a file preview, not the drawer under it, on Escape', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
    const { user, panel } = await openDrawer();
    server.use(
      http.get(
        '*/files/f1/content',
        () => new HttpResponse('img', { headers: { 'content-type': 'image/png' } }),
      ),
    );
    // Attach a file by mocking the list the drawer shows.
    server.use(
      http.get('*/tasks/:id/files', () =>
        HttpResponse.json([
          {
            fileId: 'f1',
            addedBy: 'u2',
            addedAt: 1,
            name: 'ref.png',
            mimeType: 'image/png',
            size: 2048,
            hasThumbnail: false,
          },
        ]),
      ),
    );
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Logo concepts' }));
    await user.click(await within(await drawer()).findByRole('button', { name: 'ref.png' }));
    expect(await screen.findAllByRole('dialog')).toHaveLength(2);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(screen.getByRole('dialog', { name: 'Logo concepts' })).toBeInTheDocument();
    expect(panel).not.toBeInTheDocument(); // the first drawer was closed and reopened
  });

  it('does not re-save an untouched due date, and clears it when emptied', async () => {
    const due = new Date('2027-03-01T10:30:45').getTime(); // seconds the field cannot show
    const { sent, user, panel } = await openDrawer([task({ dueAt: due })]);
    const field = within(panel).getByLabelText('Due');
    await user.click(field);
    await user.tab();
    expect(sent).toEqual([]);
    await user.clear(field);
    await user.tab();
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toEqual({ dueAt: null });
  });

  it('shows the saved title again when the Host refuses a new one', async () => {
    const { user, panel } = await openDrawer();
    server.use(
      http.patch('*/tasks/:id', () =>
        HttpResponse.json(
          { error: 'invalid_request', message: 'Title is too long' },
          { status: 400 },
        ),
      ),
    );
    const title = within(panel).getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'A rejected title');
    await user.tab();
    expect(await within(panel).findByText('Title is too long')).toBeInTheDocument();
    expect(title).toHaveValue('Logo concepts');
  });
});

describe('comments and history', () => {
  const managerComment: Comment = {
    id: 'c1',
    taskId: 't1',
    authorId: 'u2',
    authorName: 'Mia',
    body: 'Use the brand blue',
    mentions: [],
    createdAt: 1,
    editedAt: null,
  };

  it('comments with an @-mention picked from the project people', async () => {
    mockHost({}, FRED);
    const sent = mockProject('artist', [task()], { comments: [managerComment] });
    const user = userEvent.setup();
    renderApp('/projects/p1', 'tok');
    await user.click(await screen.findByRole('button', { name: 'Logo concepts' }));
    const panel = await drawer();
    expect(await within(panel).findByText('Use the brand blue')).toBeInTheDocument();
    // Fred may not edit or delete Mia's comment.
    expect(within(panel).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(
      within(panel).queryByRole('button', { name: 'Delete comment by Mia' }),
    ).not.toBeInTheDocument();

    const box = within(panel).getByLabelText('New comment');
    await user.type(box, 'Thanks @Mi');
    const offers = within(panel).getByRole('list', { name: 'Mention someone' });
    expect(
      within(offers)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['@Mia']);
    await user.click(within(offers).getByRole('button', { name: '@Mia' }));
    expect(box).toHaveValue('Thanks @Mia ');
    await user.type(box, 'will do');
    await user.click(within(panel).getByRole('button', { name: 'Comment' }));

    expect(await within(panel).findByText('Thanks @Mia will do')).toBeInTheDocument();
    expect(box).toHaveValue('');
    expect(sent).toContainEqual(
      expect.objectContaining({ body: { body: 'Thanks @Mia will do', mentionIds: ['u2'] } }),
    );
    // Fred can manage his own comment.
    expect(within(panel).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('drops a mention whose @Name was deleted from the text, and lets managers delete any comment', async () => {
    mockHost({}, MIA);
    const sent = mockProject('manager', [task()], {
      comments: [
        { ...managerComment, id: 'c9', authorId: 'u3', authorName: 'Fred', body: 'Done?' },
      ],
    });
    const user = userEvent.setup();
    renderApp('/projects/p1', 'tok');
    await user.click(await screen.findByRole('button', { name: 'Logo concepts' }));
    const panel = await drawer();
    expect(
      await within(panel).findByRole('button', { name: 'Delete comment by Fred' }),
    ).toBeInTheDocument();

    const box = within(panel).getByLabelText('New comment');
    await user.type(box, '@Fr');
    await user.click(within(panel).getByRole('button', { name: '@Fred' }));
    await user.clear(box);
    await user.type(box, 'Never mind');
    await user.click(within(panel).getByRole('button', { name: 'Comment' }));
    await within(panel).findByText('Never mind');
    expect(sent).toContainEqual(
      expect.objectContaining({ body: { body: 'Never mind', mentionIds: [] } }),
    );
  });

  it('shows the history as plain sentences', async () => {
    mockHost({}, MIA);
    mockProject('manager', [task()], {
      history: [
        { id: 'h1', event: 'created', actorName: 'Mia', at: 1 },
        { id: 'h2', event: 'status', from: 'To do', to: 'In progress', actorName: 'Fred', at: 2 },
        { id: 'h3', event: 'assignees', added: ['Fred'], removed: [], actorName: 'Mia', at: 3 },
        { id: 'h4', event: 'priority', from: 'medium', to: 'urgent', actorName: 'Mia', at: 4 },
        { id: 'h5', event: 'due', from: 5, to: null, actorName: 'Mia', at: 5 },
        { id: 'h6', event: 'file', name: 'brief.pdf', added: true, actorName: 'Mia', at: 6 },
        { id: 'h7', event: 'comment', actorName: 'Fred', at: 7 },
      ],
    });
    const user = userEvent.setup();
    renderApp('/projects/p1', 'tok');
    await user.click(await screen.findByRole('button', { name: 'Logo concepts' }));
    const panel = await drawer();
    await user.click(await within(panel).findByText('History (7)'));
    const lines = within(within(panel).getByRole('list', { name: 'History' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent?.split(' · ')[0]);
    expect(lines).toEqual([
      'Mia created the task',
      'Fred moved it from To do to In progress',
      'Mia assigned Fred',
      'Mia changed the priority from Medium to Urgent',
      'Mia removed the due date',
      'Mia attached brief.pdf',
      'Fred commented',
    ]);
  });
});
