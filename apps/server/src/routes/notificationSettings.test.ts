import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';

type Person = Awaited<ReturnType<typeof seedUser>>;

let host: TestHost;
let manager: Person;
let artist: Person;
let projectId: string;

const call = (method: 'GET' | 'POST' | 'PUT', url: string, token?: string, payload?: object) =>
  host.app.inject({ method, url, payload, headers: token ? bearer(token) : undefined });

const bellKinds = async (who: Person) =>
  (
    (await call('GET', '/notifications', who.token)).json() as { items: { kind: string }[] }
  ).items.map((n) => n.kind);

beforeEach(async () => {
  host = createTestHost();
  const owner = await setupOwner(host);
  manager = await seedUser(host.db, owner.workspaceId, 'member');
  artist = await seedUser(host.db, owner.workspaceId, 'guest');
  projectId = (await call('POST', '/projects', manager.token, { name: 'Brand' })).json().id;
});
afterEach(() => host.cleanup());

describe('notification settings', () => {
  it('starts with everything on and no summary, and keeps what is saved', async () => {
    expect((await call('GET', '/me/notification-settings', artist.token)).json()).toEqual({
      muted: [],
      dailySummary: false,
    });
    const saved = await call('PUT', '/me/notification-settings', artist.token, {
      muted: ['commented', 'commented', 'status'],
      dailySummary: true,
    });
    expect(saved.statusCode).toBe(200);
    expect((await call('GET', '/me/notification-settings', artist.token)).json()).toEqual({
      muted: ['commented', 'status'],
      dailySummary: true,
    });
    // Someone else's settings are their own.
    expect((await call('GET', '/me/notification-settings', manager.token)).json()).toEqual({
      muted: [],
      dailySummary: false,
    });
  });

  it('refuses unknown kinds, the summary as a muted kind, and signed-out callers', async () => {
    for (const muted of [['nope'], ['daily_summary']]) {
      const res = await call('PUT', '/me/notification-settings', artist.token, {
        muted,
        dailySummary: false,
      });
      expect(res.statusCode).toBe(400);
    }
    expect((await call('GET', '/me/notification-settings')).statusCode).toBe(401);
  });

  it('leaves a muted kind out of the bell, and keeps the others', async () => {
    await call('PUT', '/me/notification-settings', artist.token, {
      muted: ['assigned'],
      dailySummary: false,
    });
    await call('POST', `/projects/${projectId}/members`, manager.token, {
      userId: artist.id,
      role: 'artist',
    });
    await call('POST', `/projects/${projectId}/tasks`, manager.token, {
      title: 'Poster',
      assigneeIds: [artist.id],
    });
    expect(await bellKinds(artist)).toEqual(['added_to_project']);
  });
});
