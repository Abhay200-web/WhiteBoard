import { notificationSettings, taskStatuses, tasks } from '@whiteboard/db';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EventHub } from '../events/hub';
import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';
import { sendDailySummaries, summaryText } from './dailySummary';

// A fixed local clock: 27 Nov 2026, 09:00 on the Host. The job runs only when a test calls it.
const at = (dayOfMonth: number, hour: number) => new Date(2026, 10, dayOfMonth, hour, 0, 0);
const NOW = at(27, 9);
const HOUR = 60 * 60 * 1000;

type Person = Awaited<ReturnType<typeof seedUser>>;
type Notice = { kind: string; detail: string | null; projectName: string };

let host: TestHost;
let hub: EventHub;
let manager: Person;
let artist: Person;
let projectId: string;

const call = (method: 'GET' | 'POST' | 'PUT', url: string, token: string, payload?: object) =>
  host.app.inject({ method, url, payload, headers: bearer(token) });

async function createTask(title: string, dueAt: number | null): Promise<string> {
  const res = await call('POST', `/projects/${projectId}/tasks`, manager.token, {
    title,
    assigneeIds: [artist.id],
    dueAt,
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

function moveTo(taskId: string, kind: 'review' | 'done') {
  const status = host.db
    .select()
    .from(taskStatuses)
    .where(and(eq(taskStatuses.projectId, projectId), eq(taskStatuses.kind, kind)))
    .get()!;
  host.db.update(tasks).set({ statusId: status.id }).where(eq(tasks.id, taskId)).run();
}

const turnOn = (who: Person) =>
  call('PUT', '/me/notification-settings', who.token, { muted: [], dailySummary: true });

async function summaries(who: Person): Promise<Notice[]> {
  const { items } = (await call('GET', '/notifications', who.token)).json() as { items: Notice[] };
  return items.filter((n) => n.kind === 'daily_summary');
}

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
});
afterEach(() => host.cleanup());

describe('daily summary', () => {
  it('names only the parts that are not zero', () => {
    expect(summaryText({ overdue: 2, dueToday: 0, toReview: 3 })).toBe(
      '2 overdue, 3 waiting for your review',
    );
    expect(summaryText({ overdue: 0, dueToday: 1, toReview: 0 })).toBe('1 due today');
  });

  it('counts my overdue and due-today tasks once a day, from 08:00', async () => {
    await createTask('Late', NOW.getTime() - 26 * HOUR);
    await createTask('Today', NOW.getTime() + 3 * HOUR);
    await createTask('Tomorrow', NOW.getTime() + 24 * HOUR);
    moveTo(await createTask('Finished but late', NOW.getTime() - 2 * HOUR), 'done');
    await turnOn(artist);

    sendDailySummaries(host.db, hub, at(27, 7));
    expect(await summaries(artist)).toEqual([]);

    sendDailySummaries(host.db, hub, NOW);
    expect(await summaries(artist)).toMatchObject([
      { projectName: 'Brand', detail: '1 overdue, 1 due today' },
    ]);

    // Later the same day: nothing new. The next morning: a new summary.
    sendDailySummaries(host.db, hub, at(27, 17));
    expect(await summaries(artist)).toHaveLength(1);
    sendDailySummaries(host.db, hub, at(28, 9));
    expect(await summaries(artist)).toHaveLength(2);
  });

  it('tells a manager how many tasks wait for review, and sends nothing to people who left it off', async () => {
    moveTo(await createTask('Poster', null), 'review');
    await turnOn(manager);
    sendDailySummaries(host.db, hub, NOW);
    expect(await summaries(manager)).toMatchObject([{ detail: '1 waiting for your review' }]);
    expect(await summaries(artist)).toEqual([]);
  });

  it('marks the day done even when there is nothing to say', async () => {
    await turnOn(artist);
    sendDailySummaries(host.db, hub, NOW);
    expect(await summaries(artist)).toEqual([]);
    const row = host.db
      .select()
      .from(notificationSettings)
      .where(eq(notificationSettings.userId, artist.id))
      .get();
    expect(row?.lastSummaryDay).toBe('2026-11-27');
  });
});
