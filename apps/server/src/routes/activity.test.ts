import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  bearer,
  createTestHost,
  seedUser,
  setupOwner,
  uploadTestFile,
  type TestHost,
} from '../test-helpers';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

type Person = Awaited<ReturnType<typeof seedUser>>;
type Comment = {
  id: string;
  authorName: string;
  body: string;
  mentions: string[];
  editedAt: number | null;
};
type Entry = { event: string; actorName: string } & Record<string, unknown>;

let host: TestHost;
let owner: { token: string; workspaceId: string };
let manager: Person;
let artist: Person;
let outsider: Person;
let projectId: string;
let statusIds: Record<string, string>;
let taskId: string;

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  token?: string,
  payload?: object,
) => host.app.inject({ method, url, payload, headers: token ? bearer(token) : undefined });

const comment = (who: { token: string }, body: string, mentionIds: string[] = []) =>
  call('POST', `/tasks/${taskId}/comments`, who.token, { body, mentionIds });
const history = async () =>
  ((await call('GET', `/tasks/${taskId}/history`, manager.token)).json() as Entry[]).map(
    ({ id: _id, at: _at, ...rest }) => rest,
  );

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
  const statuses = (await call('GET', `/projects/${projectId}/statuses`, manager.token)).json();
  statusIds = Object.fromEntries(
    (statuses as { kind: string; id: string }[]).map((s) => [s.kind, s.id]),
  );
  taskId = (
    await call('POST', `/projects/${projectId}/tasks`, manager.token, {
      title: 'Logo concepts',
      assigneeIds: [artist.id],
    })
  ).json().id;
});
afterEach(() => host.cleanup());

describe('comments', () => {
  it('lets project members comment, keeping only @-mentions of people on the project', async () => {
    const res = await comment(artist, 'Which colours, @Manager?', [manager.id, outsider.id]);
    expect(res.statusCode).toBe(201);
    const [posted] = res.json() as Comment[];
    expect(posted).toMatchObject({ body: 'Which colours, @Manager?', mentions: [manager.id] });

    expect((await comment(manager, '   ')).statusCode).toBe(400);
    expect((await comment(outsider, 'Hi')).statusCode).toBe(404);
    expect((await call('GET', `/tasks/${taskId}/comments`, outsider.token)).statusCode).toBe(404);
    expect((await call('GET', `/tasks/${taskId}/comments`)).statusCode).toBe(401);
    const admin = await seedUser(host.db, owner.workspaceId, 'admin');
    expect((await comment(admin, 'Looks good')).statusCode).toBe(201);
  });

  it('only the author edits; the author or a manager deletes', async () => {
    const [mine] = (await comment(artist, 'First try')).json() as Comment[];
    const edited = await call('PATCH', `/comments/${mine!.id}`, artist.token, { body: 'Fixed' });
    expect((edited.json() as Comment[])[0]).toMatchObject({
      body: 'Fixed',
      editedAt: expect.any(Number),
    });
    expect(
      (await call('PATCH', `/comments/${mine!.id}`, manager.token, { body: 'Not yours' }))
        .statusCode,
    ).toBe(403);

    const list = (await comment(manager, 'Use the brand blue')).json() as Comment[];
    const theirs = list.find((c) => c.body === 'Use the brand blue')!;
    expect((await call('DELETE', `/comments/${theirs.id}`, artist.token)).statusCode).toBe(403);
    expect((await call('DELETE', `/comments/${mine!.id}`, manager.token)).statusCode).toBe(204);
    expect((await call('DELETE', `/comments/${theirs.id}`, outsider.token)).statusCode).toBe(404);
    const left = (await call('GET', `/tasks/${taskId}/comments`, artist.token)).json() as Comment[];
    expect(left.map((c) => c.body)).toEqual(['Use the brand blue']);
  });
});

describe('history', () => {
  it('records every change with who made it, oldest first', async () => {
    const due = Date.now() + 86_400_000;
    await call('PATCH', `/tasks/${taskId}`, artist.token, { statusId: statusIds.doing });
    await call('PATCH', `/tasks/${taskId}`, manager.token, { priority: 'urgent', dueAt: due });
    await call('PUT', `/tasks/${taskId}/assignees`, manager.token, { userIds: [manager.id] });
    const fileId = await uploadTestFile(host, manager.token, 'brief.pdf', PDF);
    await call('POST', `/tasks/${taskId}/files`, manager.token, { fileId });
    await call('DELETE', `/tasks/${taskId}/files/${fileId}`, manager.token);
    await comment(artist, 'Started');

    const managerName = (await call('GET', '/auth/me', manager.token)).json().name;
    const artistName = (await call('GET', '/auth/me', artist.token)).json().name;
    expect(await history()).toEqual([
      { event: 'created', actorName: managerName },
      { event: 'status', from: 'To do', to: 'In progress', actorName: artistName },
      { event: 'priority', from: 'medium', to: 'urgent', actorName: managerName },
      { event: 'due', from: null, to: due, actorName: managerName },
      { event: 'assignees', added: [managerName], removed: [artistName], actorName: managerName },
      { event: 'file', name: 'brief.pdf', added: true, actorName: managerName },
      { event: 'file', name: 'brief.pdf', added: false, actorName: managerName },
      { event: 'comment', actorName: artistName },
    ]);
  });

  it('records nothing for refused or no-op changes, and is visible to members only', async () => {
    await call('PATCH', `/tasks/${taskId}`, artist.token, { statusId: statusIds.done }); // refused
    await call('PATCH', `/tasks/${taskId}`, manager.token, { priority: 'medium' }); // unchanged
    await call('PUT', `/tasks/${taskId}/assignees`, manager.token, { userIds: [artist.id] }); // same
    expect((await history()).map((e) => e.event)).toEqual(['created']);
    expect((await call('GET', `/tasks/${taskId}/history`, artist.token)).statusCode).toBe(200);
    expect((await call('GET', `/tasks/${taskId}/history`, outsider.token)).statusCode).toBe(404);
  });
});
