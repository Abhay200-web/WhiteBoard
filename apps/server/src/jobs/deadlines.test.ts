import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EventHub } from '../events/hub';
import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';
import { DUE_SOON_MS, sendDeadlineAlerts } from './deadlines';

// A fixed clock: the job is run at the times the tests choose, never by a timer.
const NOW = new Date('2026-11-24T10:00:00Z');
const HOUR = 60 * 60 * 1000;

type Person = Awaited<ReturnType<typeof seedUser>>;
type Notice = { kind: string; taskId: string | null; actorName: string | null };

let host: TestHost;
let hub: EventHub;
let manager: Person;
let artist: Person;
let projectId: string;
let doneStatusId: string;

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, token?: string, payload?: object) =>
  host.app.inject({ method, url, payload, headers: token ? bearer(token) : undefined });

async function createTask(title: string, dueAt: number | null): Promise<string> {
  const res = await call('POST', `/projects/${projectId}/tasks`, manager.token, {
    title,
    assigneeIds: [artist.id],
    dueAt,
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

/** The deadline alerts in the artist's bell (not the assignment notices). */
async function artistNotices(): Promise<Notice[]> {
  const res = await call('GET', '/notifications', artist.token);
  const { items } = res.json() as { items: Notice[] };
  return items.filter((n) => n.kind === 'due_soon' || n.kind === 'overdue');
}

const run = (at: Date) => sendDeadlineAlerts(host.db, hub, at);

beforeEach(async () => {
  host = createTestHost();
  hub = new EventHub();
  const owner = await setupOwner(host);
  manager = await seedUser(host.db, owner.workspaceId, 'member');
  artist = await seedUser(host.db, owner.workspaceId, 'guest');
  projectId = (await call('POST', '/projects', manager.token, { name: 'Brand' })).json().id;
  await call('POST', `/projects/${projectId}/members`, manager.token, {
    userId: artist.id,
    role: 'artist',
  });
  const statuses = (await call('GET', `/projects/${projectId}/statuses`, manager.token)).json() as {
    id: string;
    kind: string;
  }[];
  doneStatusId = statuses.find((s) => s.kind === 'done')!.id;
});
afterEach(() => host.cleanup());

describe('deadline alerts', () => {
  it('tells the people on a task once when it is due within 24 hours', async () => {
    await createTask('Poster', NOW.getTime() + 2 * HOUR);
    run(NOW);
    run(new Date(NOW.getTime() + 15 * 60 * 1000)); // the next run must not repeat it

    const notices = await artistNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'due_soon', taskId: expect.any(String) });
    expect(notices[0]).toMatchObject({ actorName: null });
  });

  it('stays quiet for a task due later than 24 hours from now', async () => {
    await createTask('Later', NOW.getTime() + DUE_SOON_MS + HOUR);
    run(NOW);
    expect(await artistNotices()).toEqual([]);
  });

  it('says a task is overdue once its due time has passed, and not "due soon" as well', async () => {
    // The Host was off: the task went overdue before the first run that could see it.
    await createTask('Late', NOW.getTime() - 3 * HOUR);
    run(NOW);
    run(new Date(NOW.getTime() + 15 * 60 * 1000));

    const notices = await artistNotices();
    expect(notices.map((n) => n.kind)).toEqual(['overdue']);
  });

  it('sends nothing for a task that is done', async () => {
    const taskId = await createTask('Finished', NOW.getTime() + 2 * HOUR);
    await call('PATCH', `/tasks/${taskId}`, manager.token, { statusId: doneStatusId });
    run(NOW);
    expect(await artistNotices()).toEqual([]);
  });

  it('sends the alerts again when the due date is moved', async () => {
    const taskId = await createTask('Moved', NOW.getTime() + 2 * HOUR);
    run(NOW);
    await call('PATCH', `/tasks/${taskId}`, manager.token, {
      dueAt: NOW.getTime() + 5 * HOUR,
    });
    run(new Date(NOW.getTime() + 4 * HOUR)); // now within 24 hours of the new date

    const kinds = (await artistNotices()).map((n) => n.kind);
    expect(kinds).toEqual(['due_soon', 'due_soon']);
  });
});
