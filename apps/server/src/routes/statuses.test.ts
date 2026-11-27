import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';

type Person = Awaited<ReturnType<typeof seedUser>>;
type Status = { id: string; name: string; kind: string; sortKey: number };

let host: TestHost;
let manager: Person;
let artist: Person;
let outsider: Person;
let projectId: string;

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  token?: string,
  payload?: object,
) => host.app.inject({ method, url, payload, headers: token ? bearer(token) : undefined });

const statusesUrl = () => `/projects/${projectId}/statuses`;
const statuses = async () => (await call('GET', statusesUrl(), manager.token)).json() as Status[];
const byKind = async (kind: string) => (await statuses()).find((s) => s.kind === kind)!;

beforeEach(async () => {
  host = createTestHost();
  const owner = await setupOwner(host);
  manager = await seedUser(host.db, owner.workspaceId, 'member');
  artist = await seedUser(host.db, owner.workspaceId, 'guest');
  outsider = await seedUser(host.db, owner.workspaceId, 'member');
  projectId = (await call('POST', '/projects', manager.token, { name: 'Brand' })).json().id;
  await call('POST', `/projects/${projectId}/members`, manager.token, {
    userId: artist.id,
    role: 'artist',
  });
});
afterEach(() => host.cleanup());

describe('custom task statuses', () => {
  it('lets a manager add a status at the end and rename it', async () => {
    const added = await call('POST', statusesUrl(), manager.token, {
      name: ' Waiting on client ',
      kind: 'doing',
    });
    expect(added.statusCode).toBe(201);
    const list = added.json() as Status[];
    expect(list).toHaveLength(7);
    expect(list.at(-1)).toMatchObject({ name: 'Waiting on client', kind: 'doing' });

    const renamed = await call('PATCH', `${statusesUrl()}/${list.at(-1)!.id}`, manager.token, {
      name: 'With client',
    });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as Status[]).at(-1)!.name).toBe('With client');
  });

  it('reorders all statuses at once and refuses a partial or unknown list', async () => {
    const ids = (await statuses()).map((s) => s.id);
    const reversed = [...ids].reverse();
    const res = await call('PUT', `${statusesUrl()}/order`, manager.token, { ids: reversed });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Status[]).map((s) => s.id)).toEqual(reversed);

    const partial = await call('PUT', `${statusesUrl()}/order`, manager.token, {
      ids: ids.slice(1),
    });
    expect(partial.statusCode).toBe(400);
    const twice = await call('PUT', `${statusesUrl()}/order`, manager.token, {
      ids: [ids[0], ...ids.slice(0, -1)],
    });
    expect(twice.statusCode).toBe(400);
    const unknown = await call('PUT', `${statusesUrl()}/order`, manager.token, {
      ids: ['nope', ...ids.slice(1)],
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('deletes only an empty status that is not the last of its kind', async () => {
    const todo = await byKind('todo');
    const last = await call('DELETE', `${statusesUrl()}/${todo.id}`, manager.token);
    expect(last.statusCode).toBe(409);
    expect(last.json().message).toBe(
      'The project needs at least one status that behaves like To do',
    );

    const extra = (
      (
        await call('POST', statusesUrl(), manager.token, { name: 'Backlog', kind: 'todo' })
      ).json() as Status[]
    ).at(-1)!;
    await call('POST', `/projects/${projectId}/tasks`, manager.token, {
      title: 'Poster',
      statusId: extra.id,
    });
    const busy = await call('DELETE', `${statusesUrl()}/${extra.id}`, manager.token);
    expect(busy.statusCode).toBe(409);
    expect(busy.json().message).toBe('Move its 1 task to another status first');

    const empty = await call('DELETE', `${statusesUrl()}/${todo.id}`, manager.token);
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as Status[]).some((s) => s.id === todo.id)).toBe(false);
  });

  it('puts new tasks in the first To do status, in the order managers set', async () => {
    const backlog = (
      (
        await call('POST', statusesUrl(), manager.token, { name: 'Backlog', kind: 'todo' })
      ).json() as Status[]
    ).at(-1)!;
    const ids = (await statuses()).map((s) => s.id);
    await call('PUT', `${statusesUrl()}/order`, manager.token, {
      ids: [backlog.id, ...ids.filter((id) => id !== backlog.id)],
    });
    const task = await call('POST', `/projects/${projectId}/tasks`, manager.token, {
      title: 'Poster',
    });
    expect(task.json().statusId).toBe(backlog.id);
  });

  it('lets project members read but only managers change, and hides the project from others', async () => {
    expect((await call('GET', statusesUrl(), artist.token)).statusCode).toBe(200);
    const doing = await byKind('doing');
    const tries = [
      call('POST', statusesUrl(), artist.token, { name: 'Mine', kind: 'doing' }),
      call('PATCH', `${statusesUrl()}/${doing.id}`, artist.token, { name: 'Mine' }),
      call('DELETE', `${statusesUrl()}/${doing.id}`, artist.token),
    ];
    for (const res of await Promise.all(tries)) expect(res.statusCode).toBe(403);
    expect((await call('GET', statusesUrl(), outsider.token)).statusCode).toBe(404);
    expect(
      (await call('PATCH', `${statusesUrl()}/nope`, manager.token, { name: 'X' })).statusCode,
    ).toBe(404);
    expect(
      (await call('POST', statusesUrl(), manager.token, { name: ' ', kind: 'doing' })).statusCode,
    ).toBe(400);
  });
});
