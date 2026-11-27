import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';

let host: TestHost;
let owner: { token: string; workspaceId: string };
beforeEach(async () => {
  host = createTestHost();
  owner = await setupOwner(host);
});
afterEach(() => host.cleanup());

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: object) =>
  host.app.inject({ method, url, payload, headers: bearer(token) });

describe('project report', () => {
  it('counts the project’s tasks for people on the project, and hides it from outsiders', async () => {
    const manager = await seedUser(host.db, owner.workspaceId, 'member');
    const outsider = await seedUser(host.db, owner.workspaceId, 'member');
    const project = (
      await call('POST', '/projects', manager.token, { name: 'Reported' })
    ).json() as { id: string };
    const url = `/projects/${project.id}`;

    const overdue = Date.now() - 2 * 24 * 3_600_000;
    const soon = Date.now() + 2 * 24 * 3_600_000;
    await call('POST', `${url}/tasks`, manager.token, { title: 'Late', dueAt: overdue });
    await call('POST', `${url}/tasks`, manager.token, { title: 'Soon', dueAt: soon });
    const finished = (
      await call('POST', `${url}/tasks`, manager.token, { title: 'Finished' })
    ).json() as { id: string };
    const statuses = (await call('GET', `${url}/statuses`, manager.token)).json() as {
      id: string;
      kind: string;
    }[];
    const done = statuses.find((s) => s.kind === 'done')!;
    await call('PATCH', `/tasks/${finished.id}`, manager.token, { statusId: done.id });

    const report = (await call('GET', `${url}/report`, manager.token)).json() as {
      progress: { total: number; done: number; open: number; overdue: number; dueSoon: number };
    };
    expect(report.progress).toEqual({ total: 3, done: 1, open: 2, overdue: 1, dueSoon: 1 });

    expect((await call('GET', `${url}/report`, outsider.token)).statusCode).toBe(404);
    expect((await call('GET', `${url}/report`, '')).statusCode).toBe(401);
  });
});
