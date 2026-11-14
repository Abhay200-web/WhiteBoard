import type { Notification, OpenTask } from '@whiteboard/core';
import { memberships } from '@whiteboard/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EventHub } from '../events/hub';
import { expireGuests } from '../jobs/guest-expiry';
import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';

type Person = Awaited<ReturnType<typeof seedUser>>;
type Task = { id: string; assignees: { userId: string }[] };

let host: TestHost;
let owner: { token: string; workspaceId: string };
let manager: Person;
let colleague: Person;
let leaver: Person;
let projectId: string;
let statusIds: Record<string, string>;

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, token?: string, payload?: object) =>
  host.app.inject({ method, url, payload, headers: token ? bearer(token) : undefined });

const join = (userId: string, role: 'manager' | 'artist') =>
  call('POST', `/projects/${projectId}/members`, manager.token, { userId, role });
async function task(title: string) {
  const res = await call('POST', `/projects/${projectId}/tasks`, manager.token, {
    title,
    assigneeIds: [leaver.id],
  });
  return res.json() as Task;
}
const assigneesOf = async (id: string) =>
  ((await call('GET', `/tasks/${id}`, manager.token)).json() as Task).assignees.map(
    (a) => a.userId,
  );
const lastHistory = async (id: string) =>
  (
    (await call('GET', `/tasks/${id}/history`, manager.token)).json() as Record<string, unknown>[]
  ).at(-1);
const inbox = async (who: { token: string }) =>
  ((await call('GET', '/notifications', who.token)).json() as { items: Notification[] }).items;

beforeEach(async () => {
  host = createTestHost();
  owner = await setupOwner(host);
  manager = await seedUser(host.db, owner.workspaceId, 'member');
  colleague = await seedUser(host.db, owner.workspaceId, 'member');
  leaver = await seedUser(host.db, owner.workspaceId, 'guest', {
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  projectId = (await call('POST', '/projects', manager.token, { name: 'Logo' })).json().id;
  await join(colleague.id, 'artist');
  await join(leaver.id, 'artist');
  const statuses = (await call('GET', `/projects/${projectId}/statuses`, manager.token)).json();
  statusIds = Object.fromEntries(
    (statuses as { kind: string; id: string }[]).map((s) => [s.kind, s.id]),
  );
});
afterEach(() => host.cleanup());

describe('open tasks of a member', () => {
  it('lists unfinished tasks with who on the project could take each over', async () => {
    const open = await task('Logo concepts');
    const finished = await task('Kick-off');
    await call('PATCH', `/tasks/${finished.id}`, manager.token, { statusId: statusIds.done });

    const res = await call('GET', `/members/${leaver.id}/open-tasks`, owner.token);
    const list = res.json() as OpenTask[];
    expect(list.map((t) => [t.taskId, t.title, t.projectName])).toEqual([
      [open.id, 'Logo concepts', 'Logo'],
    ]);
    expect(list[0]!.candidates.map((c) => c.userId).sort()).toEqual(
      [manager.id, colleague.id].sort(),
    ); // not the leaver
    expect((await call('GET', `/members/${leaver.id}/open-tasks`, manager.token)).statusCode).toBe(
      403,
    ); // admins only
  });
});

describe('removing a member', () => {
  it('hands each open task over or leaves it unassigned, in one go', async () => {
    const handed = await task('Logo concepts');
    const left = await task('Wordmark');
    const res = await call('POST', `/members/${leaver.id}/remove`, owner.token, {
      reassign: [{ taskId: handed.id, userId: colleague.id }],
    });
    expect(res.statusCode).toBe(204);

    expect(await assigneesOf(handed.id)).toEqual([colleague.id]);
    expect(await assigneesOf(left.id)).toEqual([]);
    expect(await lastHistory(handed.id)).toMatchObject({
      event: 'left',
      auto: false,
      to: expect.any(String),
    });
    expect(await lastHistory(left.id)).toMatchObject({ event: 'left', auto: false, to: null });
    expect((await inbox(colleague))[0]).toMatchObject({ kind: 'assigned', taskId: handed.id });
    expect((await call('GET', '/auth/me', leaver.token)).statusCode).toBe(401); // signed out
  });

  it('refuses a hand-over to someone not on the project, and then changes nothing', async () => {
    const open = await task('Logo concepts');
    const stranger = await seedUser(host.db, owner.workspaceId, 'member');
    const res = await call('POST', `/members/${leaver.id}/remove`, owner.token, {
      reassign: [{ taskId: open.id, userId: stranger.id }],
    });
    expect(res.statusCode).toBe(400);
    expect(await assigneesOf(open.id)).toEqual([leaver.id]);
    expect((await call('GET', '/auth/me', leaver.token)).statusCode).toBe(200);
  });
});

describe("when a freelancer's access runs out", () => {
  it('unassigns their open tasks and tells the project managers', async () => {
    const open = await task('Logo concepts');
    const later = new Date(Date.now() + 2 * 86_400_000);
    expect(expireGuests(host.db, new EventHub(), later)).toEqual([leaver.id]);

    expect(await assigneesOf(open.id)).toEqual([]);
    expect(await lastHistory(open.id)).toMatchObject({ event: 'left', auto: true, to: null });
    expect((await inbox(manager))[0]).toMatchObject({ kind: 'access_ended', taskId: open.id });
    // Only managers hear about it (she has just her "added to project" one).
    expect((await inbox(colleague)).map((n) => n.kind)).not.toContain('access_ended');
    expect(
      host.db.select().from(memberships).where(eq(memberships.userId, leaver.id)).get()?.removedAt,
    ).toEqual(later);
  });
});
