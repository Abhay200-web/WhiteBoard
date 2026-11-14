import { jobs, memberships } from '@whiteboard/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EventHub } from './events/hub';
import { expireGuests, guestExpiryJob } from './jobs/guest-expiry';
import { runDueJobs, type Job } from './scheduler';
import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from './test-helpers';

let host: TestHost;
beforeEach(() => {
  host = createTestHost();
});
afterEach(() => host.cleanup());

const HOUR = 60 * 60 * 1000;

describe('scheduler', () => {
  it('runs a job when due, skips it until the interval passes, and catches up later', async () => {
    let runs = 0;
    const job: Job = { name: 'count', intervalMs: HOUR, run: () => void runs++ };
    const t0 = new Date('2026-01-01T00:00:00Z');

    expect(await runDueJobs(host.db, [job], t0)).toEqual(['count']);
    expect(await runDueJobs(host.db, [job], new Date(t0.getTime() + HOUR / 2))).toEqual([]);
    // Host was off for three days: the next tick still runs it, once.
    expect(await runDueJobs(host.db, [job], new Date(t0.getTime() + 72 * HOUR))).toEqual(['count']);
    expect(runs).toBe(2);
    expect(host.db.select().from(jobs).get()?.lastStatus).toBe('ok');
  });

  it('records failures and still runs the other jobs', async () => {
    let ok = 0;
    const bad: Job = {
      name: 'bad',
      intervalMs: HOUR,
      run: () => {
        throw new Error('boom');
      },
    };
    const good: Job = { name: 'good', intervalMs: HOUR, run: () => void ok++ };
    await runDueJobs(host.db, [bad, good]);
    expect(ok).toBe(1);
    expect(host.db.select().from(jobs).where(eq(jobs.name, 'bad')).get()).toMatchObject({
      lastStatus: 'error',
      lastError: 'boom',
    });
  });
});

describe('guest expiry job', () => {
  it('removes expired guests and signs them out, leaving others alone', async () => {
    const { token: ownerToken, workspaceId } = await setupOwner(host);
    const expired = await seedUser(host.db, workspaceId, 'guest', {
      expiresAt: new Date(Date.now() + 1000),
    });
    const active = await seedUser(host.db, workspaceId, 'guest', {
      expiresAt: new Date(Date.now() + 30 * 24 * HOUR),
    });
    const member = await seedUser(host.db, workspaceId, 'member');

    const later = new Date(Date.now() + 2000);
    expect(expireGuests(host.db, new EventHub(), later)).toEqual([expired.id]);

    const get = (token: string) =>
      host.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(token) });
    expect((await get(expired.token)).statusCode).toBe(401);
    expect((await get(active.token)).statusCode).toBe(200);
    expect((await get(member.token)).statusCode).toBe(200);
    expect((await get(ownerToken)).statusCode).toBe(200);
    const row = host.db.select().from(memberships).where(eq(memberships.userId, expired.id)).get();
    expect(row?.removedAt).toEqual(later);
  });

  it('is registered as a daily job', () => {
    expect(guestExpiryJob(new EventHub()).intervalMs).toBe(24 * HOUR);
  });
});
