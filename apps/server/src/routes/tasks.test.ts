import { canMoveTask } from '@whiteboard/core';
import { tasks } from '@whiteboard/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  bearer,
  createTestHost,
  removeMember,
  seedUser,
  setupOwner,
  uploadTestFile,
  type TestHost,
} from '../test-helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

type Person = Awaited<ReturnType<typeof seedUser>>;
type Status = { id: string; name: string; kind: string };
type Task = {
  id: string;
  statusId: string;
  title: string;
  sortKey: number;
  assignees: { userId: string }[];
  subtaskCounts: { done: number; total: number };
  fileCount: number;
};

let host: TestHost;
let owner: { token: string; workspaceId: string };
let manager: Person;
let artist: Person;
let outsider: Person;
let projectId: string;
let statuses: Record<string, Status>;

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  token?: string,
  payload?: object,
) => host.app.inject({ method, url, payload, headers: token ? bearer(token) : undefined });

async function createTask(body: object = {}, who: { token: string } = manager) {
  const res = await call('POST', `/projects/${projectId}/tasks`, who.token, {
    title: 'Logo concepts',
    ...body,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Task;
}

const move = (task: Task, kind: string, who: { token: string }) =>
  call('PATCH', `/tasks/${task.id}`, who.token, { statusId: statuses[kind]!.id });

beforeEach(async () => {
  host = createTestHost();
  owner = await setupOwner(host);
  manager = await seedUser(host.db, owner.workspaceId, 'member');
  artist = await seedUser(host.db, owner.workspaceId, 'guest');
  outsider = await seedUser(host.db, owner.workspaceId, 'member');
  projectId = (await call('POST', '/projects', manager.token, { name: 'Logo' })).json().id;
  await call('POST', `/projects/${projectId}/members`, manager.token, {
    userId: artist.id,
    role: 'artist',
  });
  const list = (await call('GET', `/projects/${projectId}/statuses`, artist.token)).json();
  statuses = Object.fromEntries((list as Status[]).map((s) => [s.kind, s]));
});
afterEach(() => host.cleanup());

describe('status rules', () => {
  it('lets assignees move only between to do, in progress and changes; nobody hand-moves into review', () => {
    expect(canMoveTask('todo', 'doing', false)).toBe(true);
    expect(canMoveTask('doing', 'todo', false)).toBe(true);
    expect(canMoveTask('changes', 'doing', false)).toBe(true);
    expect(canMoveTask('doing', 'approved', false)).toBe(false);
    expect(canMoveTask('todo', 'done', false)).toBe(false);
    expect(canMoveTask('doing', 'approved', true)).toBe(true);
    expect(canMoveTask('doing', 'review', true)).toBe(false);
    expect(canMoveTask('review', 'review', false)).toBe(true);
  });
});

describe('statuses and tasks', () => {
  it('lists the six columns in order to members, and hides them from outsiders', async () => {
    const res = await call('GET', `/projects/${projectId}/statuses`, manager.token);
    expect((res.json() as Status[]).map((s) => s.name)).toEqual([
      'To do',
      'In progress',
      'In review',
      'Changes requested',
      'Approved',
      'Done',
    ]);
    expect((await call('GET', `/projects/${projectId}/statuses`, outsider.token)).statusCode).toBe(
      404,
    );
  });

  it('creates a task in To do with its assignee, and lists tasks column by column', async () => {
    const due = Date.now() + 3 * 86_400_000;
    const task = await createTask({ priority: 'high', dueAt: due, assigneeIds: [artist.id] });
    expect(task).toMatchObject({
      title: 'Logo concepts',
      priority: 'high',
      dueAt: due,
      statusId: statuses.todo!.id,
      assignees: [{ userId: artist.id, name: expect.any(String) }],
      subtaskCounts: { done: 0, total: 0 },
      fileCount: 0,
    });

    const second = await createTask({ title: 'Wordmark' });
    const done = await createTask({ title: 'Kick-off', statusId: statuses.done!.id });
    expect(second.sortKey).toBeGreaterThan(task.sortKey);

    // Reorder inside the column: the second card goes first.
    await call('PATCH', `/tasks/${second.id}`, manager.token, { sortKey: task.sortKey - 1 });
    const list = (await call('GET', `/projects/${projectId}/tasks`, artist.token)).json() as Task[];
    expect(list.map((t) => t.id)).toEqual([second.id, task.id, done.id]);
  });

  it('validates the body, the status and that assignees are on the project', async () => {
    const url = `/projects/${projectId}/tasks`;
    expect((await call('POST', url, manager.token, { title: ' ' })).statusCode).toBe(400);
    expect(
      (await call('POST', url, manager.token, { title: 'x', priority: 'asap' })).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', url, manager.token, { title: 'x', startAt: 2000, dueAt: 1000 }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('POST', url, manager.token, { title: 'x', statusId: 'nope' })).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', url, manager.token, { title: 'x', statusId: statuses.review!.id }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('POST', url, manager.token, { title: 'x', assigneeIds: [outsider.id] }))
        .statusCode,
    ).toBe(400);

    removeMember(host.db, artist.id);
    const res = await call('POST', url, manager.token, { title: 'x', assigneeIds: [artist.id] });
    expect(res.json().message).toBe('Tasks can only be assigned to people on this project');
  });

  it('lets the manager edit, reassign and delete a task', async () => {
    const task = await createTask();
    const edited = await call('PATCH', `/tasks/${task.id}`, manager.token, {
      title: 'Logo concepts v2',
      priority: 'urgent',
      dueAt: null,
    });
    expect(edited.json()).toMatchObject({ title: 'Logo concepts v2', priority: 'urgent' });

    const assigned = await call('PUT', `/tasks/${task.id}/assignees`, manager.token, {
      userIds: [artist.id, manager.id, artist.id],
    });
    expect((assigned.json() as Task).assignees.map((a) => a.userId).sort()).toEqual(
      [artist.id, manager.id].sort(),
    );
    expect(
      (await call('PUT', `/tasks/${task.id}/assignees`, manager.token, { userIds: [outsider.id] }))
        .statusCode,
    ).toBe(400);

    expect((await call('DELETE', `/tasks/${task.id}`, manager.token)).statusCode).toBe(204);
    expect((await call('GET', `/tasks/${task.id}`, manager.token)).statusCode).toBe(404);
  });
});

describe('who may do what', () => {
  it('artists read but cannot manage; outsiders get 404; anonymous 401; admins manage', async () => {
    const task = await createTask();
    const sub = (
      await call('POST', `/tasks/${task.id}/subtasks`, manager.token, { title: 'Sketch' })
    ).json()[0] as { id: string };
    const routes: [
      method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
      url: string,
      body?: object,
    ][] = [
      ['GET', `/projects/${projectId}/statuses`],
      ['GET', `/projects/${projectId}/tasks`],
      ['POST', `/projects/${projectId}/tasks`, { title: 'x' }],
      ['GET', `/tasks/${task.id}`],
      ['PATCH', `/tasks/${task.id}`, { title: 'x' }],
      ['PUT', `/tasks/${task.id}/assignees`, { userIds: [] }],
      ['GET', `/tasks/${task.id}/subtasks`],
      ['POST', `/tasks/${task.id}/subtasks`, { title: 'x' }],
      ['PATCH', `/subtasks/${sub.id}`, { title: 'x' }],
      ['GET', `/tasks/${task.id}/files`],
      ['POST', `/tasks/${task.id}/files`, { fileId: 'nope' }],
      ['DELETE', `/tasks/${task.id}/files/nope`],
      ['DELETE', `/subtasks/${sub.id}`],
      ['DELETE', `/tasks/${task.id}`],
    ];
    const admin = await seedUser(host.db, owner.workspaceId, 'admin');
    for (const [method, url, body] of routes) {
      const reads = method === 'GET';
      const label = `${method} ${url}`;
      expect((await call(method, url, undefined, body)).statusCode, label).toBe(401);
      expect((await call(method, url, outsider.token, body)).statusCode, label).toBe(404);
      expect((await call(method, url, artist.token, body)).statusCode, label).toBe(
        reads ? 200 : 403,
      );
      // The admin is not on the project but may do everything (missing files are still 404).
      expect([401, 403], label).not.toContain(
        (await call(method, url, admin.token, body)).statusCode,
      );
    }
  });
});

describe('moving tasks', () => {
  it('lets the assignee start and pause work, but only a manager approves; review needs a submission', async () => {
    const task = await createTask({ assigneeIds: [artist.id] });
    expect((await move(task, 'doing', artist)).statusCode).toBe(200);
    expect((await move(task, 'todo', artist)).statusCode).toBe(200);
    expect((await move(task, 'approved', artist)).statusCode).toBe(403);
    expect((await move(task, 'review', artist)).statusCode).toBe(403);
    expect((await move(task, 'review', manager)).statusCode).toBe(403);

    expect((await move(task, 'changes', manager)).statusCode).toBe(200);
    expect((await move(task, 'doing', artist)).statusCode).toBe(200);
    const approved = await move(task, 'approved', manager);
    expect(approved.json().statusId).toBe(statuses.approved!.id);
  });

  it('stops artists editing details, or moving tasks that are not theirs', async () => {
    const mine = await createTask({ assigneeIds: [artist.id] });
    const notMine = await createTask();
    expect(
      (await call('PATCH', `/tasks/${mine.id}`, artist.token, { title: 'Mine now' })).statusCode,
    ).toBe(403);
    expect((await move(notMine, 'doing', artist)).statusCode).toBe(403);
    expect(
      (await call('PATCH', `/tasks/${mine.id}`, artist.token, { statusId: 'nope' })).statusCode,
    ).toBe(400);
  });

  it('puts a moved card at the end of its new column unless a position is given', async () => {
    const a = await createTask({ statusId: statuses.doing!.id });
    const b = await createTask();
    const moved = (await move(b, 'doing', manager)).json() as Task;
    expect(moved.sortKey).toBeGreaterThan(a.sortKey);
  });
});

describe('subtasks and files', () => {
  it('managers build the checklist; the assignee ticks items; counts show on the task', async () => {
    const task = await createTask({ assigneeIds: [artist.id] });
    await call('POST', `/tasks/${task.id}/subtasks`, manager.token, { title: 'Sketch' });
    const list = (
      await call('POST', `/tasks/${task.id}/subtasks`, manager.token, { title: 'Ink' })
    ).json() as { id: string; title: string }[];
    expect(list.map((s) => s.title)).toEqual(['Sketch', 'Ink']);

    const ticked = await call('PATCH', `/subtasks/${list[0]!.id}`, artist.token, { done: true });
    expect(ticked.statusCode).toBe(200);
    expect(
      (await call('PATCH', `/subtasks/${list[0]!.id}`, artist.token, { title: 'x' })).statusCode,
    ).toBe(403);
    const after = (await call('GET', `/tasks/${task.id}`, artist.token)).json() as Task;
    expect(after.subtaskCounts).toEqual({ done: 1, total: 2 });
  });

  it('attaches a file that project members can then open; removing the task keeps the file', async () => {
    const task = await createTask();
    const fileId = await uploadTestFile(host, manager.token, 'brief.pdf', PDF);
    // Before it is attached, the artist cannot read the manager's upload.
    expect((await call('GET', `/files/${fileId}`, artist.token)).statusCode).toBe(404);

    // Only files the caller can already read may be attached.
    const theirs = await uploadTestFile(host, outsider.token, 'x.pdf', PDF);
    expect(
      (await call('POST', `/tasks/${task.id}/files`, manager.token, { fileId: theirs })).statusCode,
    ).toBe(404);

    const res = await call('POST', `/tasks/${task.id}/files`, manager.token, { fileId });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual([expect.objectContaining({ fileId, name: 'brief.pdf' })]);
    expect(((await call('GET', `/tasks/${task.id}`, manager.token)).json() as Task).fileCount).toBe(
      1,
    );
    expect((await call('GET', `/files/${fileId}`, artist.token)).statusCode).toBe(200);
    expect((await call('GET', `/files/${fileId}`, outsider.token)).statusCode).toBe(404);

    expect(
      (await call('DELETE', `/tasks/${task.id}/files/${fileId}`, manager.token)).statusCode,
    ).toBe(204);
    expect((await call('GET', `/files/${fileId}`, artist.token)).statusCode).toBe(404);
    expect((await call('DELETE', `/tasks/${task.id}`, manager.token)).statusCode).toBe(204);
    expect((await call('GET', `/files/${fileId}`, manager.token)).statusCode).toBe(200);
  });
});

describe('leaving a project and reordering', () => {
  it("takes people off the project's tasks when they leave it, so the task can be reassigned", async () => {
    const task = await createTask({ assigneeIds: [artist.id] });
    const removed = await call(
      'DELETE',
      `/projects/${projectId}/members/${artist.id}`,
      manager.token,
    );
    expect(removed.statusCode).toBe(204);
    const after = (await call('GET', `/tasks/${task.id}`, manager.token)).json() as Task;
    expect(after.assignees).toEqual([]);
    const reassigned = await call('PUT', `/tasks/${task.id}/assignees`, manager.token, {
      userIds: [manager.id],
    });
    expect(reassigned.statusCode).toBe(200);
  });

  it('renumbers a column when a dropped card ties with its neighbour', async () => {
    await createTask({ title: 'A' }); // sort key 1000
    const b = await createTask({ title: 'B' }); // 2000
    const c = await createTask({ title: 'C' }); // 3000
    await call('PATCH', `/tasks/${b.id}`, manager.token, { sortKey: 1001 }); // no gap left after A
    // The board drops C before B at floor((1000 + 1001) / 2) = 1000, the same key as A.
    const moved = await call('PATCH', `/tasks/${c.id}`, manager.token, { sortKey: 1000 });
    expect(moved.json().sortKey).toBe(2000);
    const list = (
      await call('GET', `/projects/${projectId}/tasks`, manager.token)
    ).json() as Task[];
    expect(list.map((t) => [t.title, t.sortKey])).toEqual([
      ['A', 1000],
      ['C', 2000],
      ['B', 3000],
    ]);
  });
});

describe('across projects', () => {
  type MyTask = Task & { projectName: string; statusName: string };
  const mine = async (who: { token: string }, url = '/me/tasks') =>
    (await call('GET', url, who.token)).json() as MyTask[];

  /** A second project run by the manager, with the artist on it. */
  async function otherProject(name: string) {
    const id = (await call('POST', '/projects', manager.token, { name })).json().id as string;
    await call('POST', `/projects/${id}/members`, manager.token, {
      userId: artist.id,
      role: 'artist',
    });
    return id;
  }

  it('lists my open tasks from every project, leaving out finished ones and archived projects', async () => {
    await createTask({ title: 'Wordmark', assigneeIds: [artist.id] });
    const finished = await createTask({ title: 'Kick-off', assigneeIds: [artist.id] });
    await move(finished, 'done', manager);
    await createTask({ title: 'Not mine' });

    const second = await otherProject('Packaging');
    await call('POST', `/projects/${second}/tasks`, manager.token, {
      title: 'Box design',
      assigneeIds: [artist.id],
    });
    const archived = await otherProject('Old pitch');
    await call('POST', `/projects/${archived}/tasks`, manager.token, {
      title: 'Old sketch',
      assigneeIds: [artist.id],
    });
    await call('POST', `/projects/${archived}/status`, manager.token, { status: 'archived' });

    const list = await mine(artist);
    expect(list.map((t) => [t.title, t.projectName, t.statusName])).toEqual([
      ['Wordmark', 'Logo', 'To do'],
      ['Box design', 'Packaging', 'To do'],
    ]);
    expect(await mine(outsider)).toEqual([]);
    expect((await call('GET', '/me/tasks')).statusCode).toBe(401);
  });

  it('shows the review queue to the managers of the project and admins only', async () => {
    const waiting = await createTask({ title: 'Logo v1', assigneeIds: [artist.id] });
    await createTask({ title: 'Still to do' });
    // Only "Submit for review" (Part 5) moves a task into review, so set it directly here.
    host.db
      .update(tasks)
      .set({ statusId: statuses.review!.id })
      .where(eq(tasks.id, waiting.id))
      .run();

    const queue = (who: { token: string }) => mine(who, '/me/review-queue');
    expect((await queue(manager)).map((t) => t.title)).toEqual(['Logo v1']);
    const admin = await seedUser(host.db, owner.workspaceId, 'admin');
    expect((await queue(admin)).map((t) => t.title)).toEqual(['Logo v1']);
    expect(await queue(artist)).toEqual([]); // assigned, but not a manager
    const otherManager = await seedUser(host.db, owner.workspaceId, 'member');
    await call('POST', '/projects', otherManager.token, { name: 'Theirs' });
    expect(await queue(otherManager)).toEqual([]); // manages a different project
  });
});
