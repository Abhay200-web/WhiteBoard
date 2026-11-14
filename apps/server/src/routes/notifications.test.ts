import type { Notification } from '@whiteboard/core';
import { memberships, notifications } from '@whiteboard/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';

type Person = Awaited<ReturnType<typeof seedUser>>;
type Inbox = { items: Notification[]; unread: number };

let host: TestHost;
let owner: { token: string; workspaceId: string };
let manager: Person;
let artist: Person;
let projectId: string;

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  token?: string,
  payload?: object,
) => host.app.inject({ method, url, payload, headers: token ? bearer(token) : undefined });

const inbox = async (who: { token: string }) =>
  (await call('GET', '/notifications', who.token)).json() as Inbox;
const kinds = async (who: { token: string }) => (await inbox(who)).items.map((n) => n.kind);

async function createTask(body: object = {}) {
  const res = await call('POST', `/projects/${projectId}/tasks`, manager.token, {
    title: 'Logo concepts',
    ...body,
  });
  return res.json() as { id: string };
}

beforeEach(async () => {
  host = createTestHost();
  owner = await setupOwner(host);
  manager = await seedUser(host.db, owner.workspaceId, 'member');
  artist = await seedUser(host.db, owner.workspaceId, 'guest');
  projectId = (await call('POST', '/projects', manager.token, { name: 'Logo' })).json().id;
  await call('POST', `/projects/${projectId}/members`, manager.token, {
    userId: artist.id,
    role: 'artist',
  });
});
afterEach(() => host.cleanup());

describe('who is told', () => {
  it('tells people they were added or assigned, never the person who did it', async () => {
    await createTask({ assigneeIds: [artist.id, manager.id] });
    const box = await inbox(artist);
    expect(box.unread).toBe(2);
    expect(box.items[0]).toMatchObject({
      kind: 'assigned',
      taskTitle: 'Logo concepts',
      projectName: 'Logo',
      actorName: expect.any(String),
    });
    expect(box.items[1]).toMatchObject({ kind: 'added_to_project', taskId: null });
    expect(await kinds(manager)).toEqual([]); // the manager did both

    const later = await createTask({ title: 'Wordmark' });
    await call('PUT', `/tasks/${later.id}/assignees`, manager.token, { userIds: [artist.id] });
    await call('PUT', `/tasks/${later.id}/assignees`, manager.token, { userIds: [artist.id] });
    expect(await kinds(artist)).toEqual(['assigned', 'assigned', 'added_to_project']); // not twice
  });

  it('tells the task creator when an assignee moves it', async () => {
    const task = await createTask({ assigneeIds: [artist.id] });
    const statuses = (await call('GET', `/projects/${projectId}/statuses`, manager.token)).json();
    const doing = (statuses as { kind: string; id: string }[]).find((s) => s.kind === 'doing')!;
    await call('PATCH', `/tasks/${task.id}`, artist.token, { statusId: doing.id });
    expect((await inbox(manager)).items[0]).toMatchObject({
      kind: 'status',
      detail: 'In progress',
    });
    expect(await kinds(artist)).toEqual(['assigned', 'added_to_project']);
  });

  it('tells mentioned people once, and the rest of the task that someone commented', async () => {
    const task = await createTask({ assigneeIds: [artist.id] });
    const third = await seedUser(host.db, owner.workspaceId, 'member');
    await call('POST', `/projects/${projectId}/members`, manager.token, {
      userId: third.id,
      role: 'artist',
    });
    await call('PUT', `/tasks/${task.id}/assignees`, manager.token, {
      userIds: [artist.id, third.id],
    });

    const posted = await call('POST', `/tasks/${task.id}/comments`, artist.token, {
      body: 'Which colours, @Manager?',
      mentionIds: [manager.id],
    });
    expect((await inbox(manager)).items[0]).toMatchObject({
      kind: 'mentioned',
      detail: 'Which colours, @Manager?',
    });
    expect((await kinds(manager)).filter((k) => k === 'commented')).toEqual([]); // not both
    expect((await kinds(third))[0]).toBe('commented');
    expect((await kinds(artist))[0]).not.toBe('commented'); // the author

    // Editing to add a mention tells only the newly mentioned person.
    const commentId = (posted.json() as { id: string }[])[0]!.id;
    const before = (await inbox(manager)).items.length;
    await call('PATCH', `/comments/${commentId}`, artist.token, {
      body: 'Which colours, @Manager and @Third?',
      mentionIds: [manager.id, third.id],
    });
    expect((await inbox(manager)).items).toHaveLength(before);
    expect((await kinds(third))[0]).toBe('mentioned');
  });
});

describe('after losing access to a project', () => {
  it('tells someone removed from a project nothing more, even about tasks they created', async () => {
    const task = await createTask({ assigneeIds: [artist.id] });
    const comment = (body: string) =>
      call('POST', `/tasks/${task.id}/comments`, artist.token, { body });
    await comment('First sketches attached');
    expect(await kinds(manager)).toEqual(['commented']); // the creator hears about it

    // A second manager takes the first one off the project. Her account stays.
    const other = await seedUser(host.db, owner.workspaceId, 'member');
    await call('POST', `/projects/${projectId}/members`, manager.token, {
      userId: other.id,
      role: 'manager',
    });
    const removed = await call(
      'DELETE',
      `/projects/${projectId}/members/${manager.id}`,
      other.token,
    );
    expect(removed.statusCode).toBe(204);

    await comment('Client agreed to the budget, ship by Friday');
    // Neither the new comment nor the old notification shows: no task titles, no excerpts.
    expect(await inbox(manager)).toEqual({ items: [], unread: 0 });
    expect(
      host.db.select().from(notifications).where(eq(notifications.userId, manager.id)).all(),
    ).toHaveLength(1); // the old row is kept, only hidden
  });

  it('stops telling an admin about projects they only saw as an admin once they are demoted', async () => {
    const admin = await seedUser(host.db, owner.workspaceId, 'admin');
    const task = await call('POST', `/projects/${projectId}/tasks`, admin.token, {
      title: 'Admin task',
      assigneeIds: [artist.id],
    });
    const taskId = (task.json() as { id: string }).id;
    const statuses = (await call('GET', `/projects/${projectId}/statuses`, admin.token)).json();
    const byKind = Object.fromEntries(
      (statuses as { kind: string; id: string }[]).map((s) => [s.kind, s.id]),
    );
    await call('PATCH', `/tasks/${taskId}`, artist.token, { statusId: byKind.doing });
    expect(await kinds(admin)).toEqual(['status']); // admins see every project

    host.db
      .update(memberships)
      .set({ role: 'member' })
      .where(eq(memberships.userId, admin.id))
      .run();
    await call('PATCH', `/tasks/${taskId}`, artist.token, { statusId: byKind.todo });
    expect(await inbox(admin)).toEqual({ items: [], unread: 0 });
  });
});

describe('reading', () => {
  it('marks one or all read, only ever my own', async () => {
    await createTask({ assigneeIds: [artist.id] });
    const box = await inbox(artist);
    expect(box.unread).toBe(2);

    // Someone else cannot mark the artist's notifications read.
    await call('POST', '/notifications/read', manager.token, { ids: [box.items[0]!.id] });
    expect((await inbox(artist)).unread).toBe(2);

    await call('POST', '/notifications/read', artist.token, { ids: [box.items[0]!.id] });
    const after = await inbox(artist);
    expect(after.unread).toBe(1);
    expect(after.items[0]!.readAt).toEqual(expect.any(Number));

    expect((await call('POST', '/notifications/read', artist.token)).statusCode).toBe(204);
    expect((await inbox(artist)).unread).toBe(0);
    expect((await call('GET', '/notifications')).statusCode).toBe(401);
  });
});

describe('live /events', () => {
  /** Opens a live connection and collects what the Host sends. */
  async function connect(token: string) {
    await host.app.ready();
    const socket = await host.app.injectWS('/events');
    const received: string[] = [];
    let closed: number | null = null;
    socket.on('message', (data: { toString(): string }) => received.push(data.toString()));
    socket.on('close', (code: number) => (closed = code));
    socket.send(JSON.stringify({ type: 'auth', token }));
    return { socket, received, closedWith: () => closed };
  }
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  };

  it('pings a signed-in person the moment they are notified', async () => {
    const live = await connect(artist.token);
    await until(() => live.received.length > 0);
    expect(live.received).toEqual([JSON.stringify({ type: 'ready' })]);

    await createTask({ assigneeIds: [artist.id] });
    await until(() => live.received.length > 1);
    expect(live.received[1]).toBe(JSON.stringify({ type: 'notification' }));
    live.socket.terminate();
  });

  it('closes the connection when the token is wrong', async () => {
    const live = await connect('not-a-token');
    await until(() => live.closedWith() !== null);
    expect(live.closedWith()).toBe(4401);
    expect(live.received).toEqual([]);
  });
});
