import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';

let host: TestHost;
let owner: { token: string; workspaceId: string };
beforeEach(async () => {
  host = createTestHost();
  owner = await setupOwner(host);
});
afterEach(() => host.cleanup());

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, token: string, payload?: object) =>
  host.app.inject({ method, url, payload, headers: bearer(token) });

describe('saved task filters', () => {
  it('keeps each view to the person who saved it, on its project', async () => {
    const manager = await seedUser(host.db, owner.workspaceId, 'member');
    const other = await seedUser(host.db, owner.workspaceId, 'member');
    const project = (
      await call('POST', '/projects', manager.token, { name: 'Filters' })
    ).json() as { id: string };

    const created = await call('POST', `/projects/${project.id}/saved-filters`, manager.token, {
      name: '  Urgent this week  ',
      filter: { priority: 'urgent', statusId: null },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: 'Urgent this week',
      projectId: project.id,
      filter: { priority: 'urgent', statusId: null },
    });

    const mine = (
      await call('GET', `/projects/${project.id}/saved-filters`, manager.token)
    ).json() as { id: string }[];
    expect(mine).toHaveLength(1);
    expect(
      (await call('GET', `/projects/${project.id}/saved-filters`, other.token)).statusCode,
    ).toBe(404);
    expect(
      (await call('GET', `/projects/${project.id}/saved-filters`, owner.token)).json(),
    ).toEqual([]);

    // Someone else cannot delete it; the owner can.
    const id = mine[0]!.id;
    expect((await call('DELETE', `/saved-filters/${id}`, other.token)).statusCode).toBe(404);
    expect((await call('DELETE', `/saved-filters/${id}`, manager.token)).statusCode).toBe(204);
    expect(
      (await call('GET', `/projects/${project.id}/saved-filters`, manager.token)).json(),
    ).toEqual([]);
  });

  it('refuses an empty name and a bad filter', async () => {
    const manager = await seedUser(host.db, owner.workspaceId, 'member');
    const project = (await call('POST', '/projects', manager.token, { name: 'Checks' })).json() as {
      id: string;
    };
    const url = `/projects/${project.id}/saved-filters`;
    expect((await call('POST', url, manager.token, { name: '  ', filter: {} })).statusCode).toBe(
      400,
    );
    expect(
      (await call('POST', url, manager.token, { name: 'x', filter: { priority: 'whenever' } }))
        .statusCode,
    ).toBe(400);
  });
});
