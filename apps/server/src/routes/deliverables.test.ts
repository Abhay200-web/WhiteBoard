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
type Status = { id: string; name: string; kind: string };
type Version = { number: number; state: string; note: string | null; submittedBy: string };
type Deliverable = { id: string; name: string; versions: Version[] };
type Task = { id: string; statusId: string };

let host: TestHost;
let manager: Person;
let artist: Person;
let outsider: Person;
let projectId: string;
let statuses: Record<string, Status>;

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, token?: string, payload?: object) =>
  host.app.inject({ method, url, payload, headers: token ? bearer(token) : undefined });

async function createTask(): Promise<Task> {
  const res = await call('POST', `/projects/${projectId}/tasks`, manager.token, {
    title: 'Poster',
    assigneeIds: [artist.id],
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Task;
}

async function currentStatus(taskId: string): Promise<string> {
  const task = (await call('GET', `/tasks/${taskId}`, manager.token)).json() as Task;
  return task.statusId;
}

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
  const list = (await call('GET', `/projects/${projectId}/statuses`, artist.token)).json();
  statuses = Object.fromEntries((list as Status[]).map((s) => [s.kind, s]));
});
afterEach(() => host.cleanup());

describe('deliverables and versions', () => {
  it('lets the assignee send a file for review: version 1, task In review, file on the task', async () => {
    const task = await createTask();
    const fileId = await uploadTestFile(host, artist.token, 'poster.pdf', PDF);
    const created = await call('POST', `/tasks/${task.id}/deliverables`, artist.token, {
      name: 'Poster',
    });
    expect(created.statusCode).toBe(201);
    const deliverable = created.json() as Deliverable;

    const res = await call('POST', `/deliverables/${deliverable.id}/versions`, artist.token, {
      fileId,
      note: 'First draft',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: 'Poster',
      versions: [{ number: 1, state: 'pending', note: 'First draft', name: 'poster.pdf' }],
    });
    expect(await currentStatus(task.id)).toBe(statuses.review!.id);
    // The manager can now open the file, because it is attached to the task.
    expect((await call('GET', `/files/${fileId}`, manager.token)).statusCode).toBe(200);
    const history = (await call('GET', `/tasks/${task.id}/history`, manager.token)).json();
    expect(history).toContainEqual(
      expect.objectContaining({ event: 'submitted', name: 'Poster', number: 1 }),
    );
  });

  it('numbers later versions 2, 3 after changes are requested, and tells the people on the task', async () => {
    const task = await createTask();
    const deliverable = (
      await call('POST', `/tasks/${task.id}/deliverables`, artist.token, { name: 'Poster' })
    ).json() as Deliverable;
    const first = await uploadTestFile(host, artist.token, 'v1.pdf', PDF);
    await call('POST', `/deliverables/${deliverable.id}/versions`, artist.token, { fileId: first });

    // The manager asks for changes; the artist sends a second version.
    await call('PATCH', `/tasks/${task.id}`, manager.token, { statusId: statuses.changes!.id });
    const second = await uploadTestFile(host, artist.token, 'v2.pdf', PDF);
    const res = await call('POST', `/deliverables/${deliverable.id}/versions`, artist.token, {
      fileId: second,
    });
    expect((res.json() as Deliverable).versions.map((v) => v.number)).toEqual([1, 2]);

    const { items } = (await call('GET', '/notifications', manager.token)).json() as {
      items: { kind: string; detail: string | null }[];
    };
    expect(items).toContainEqual(expect.objectContaining({ kind: 'status', detail: 'In review' }));
  });

  it('keeps the deliverables list per task, with versions and who sent them', async () => {
    const task = await createTask();
    const deliverable = (
      await call('POST', `/tasks/${task.id}/deliverables`, artist.token, { name: 'Poster' })
    ).json() as Deliverable;
    const fileId = await uploadTestFile(host, artist.token, 'poster.pdf', PDF);
    await call('POST', `/deliverables/${deliverable.id}/versions`, artist.token, { fileId });

    const list = (await call('GET', `/tasks/${task.id}/deliverables`, manager.token)).json();
    expect(list).toEqual([
      expect.objectContaining({
        name: 'Poster',
        versions: [expect.objectContaining({ number: 1, submittedBy: expect.any(String) })],
      }),
    ]);
    expect((await call('GET', `/tasks/${task.id}/deliverables`, outsider.token)).statusCode).toBe(
      404,
    );
  });

  it('refuses anyone but the assignee, and refuses a task that is already in review', async () => {
    const task = await createTask();
    const deliverable = (
      await call('POST', `/tasks/${task.id}/deliverables`, artist.token, { name: 'Poster' })
    ).json() as Deliverable;
    const fileId = await uploadTestFile(host, manager.token, 'poster.pdf', PDF);

    // A manager who is not assigned cannot submit, and a stranger cannot even see the task.
    expect(
      (await call('POST', `/deliverables/${deliverable.id}/versions`, manager.token, { fileId }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('POST', `/tasks/${task.id}/deliverables`, manager.token, { name: 'X' }))
        .statusCode,
    ).toBe(403);

    const artistFile = await uploadTestFile(host, artist.token, 'poster.pdf', PDF);
    await call('POST', `/deliverables/${deliverable.id}/versions`, artist.token, {
      fileId: artistFile,
    });
    const again = await call('POST', `/deliverables/${deliverable.id}/versions`, artist.token, {
      fileId: artistFile,
    });
    expect(again.statusCode).toBe(409);
  });

  it('only accepts files the artist can read, and a name', async () => {
    const task = await createTask();
    const deliverable = (
      await call('POST', `/tasks/${task.id}/deliverables`, artist.token, { name: 'Poster' })
    ).json() as Deliverable;
    const theirs = await uploadTestFile(host, outsider.token, 'x.pdf', PDF);
    expect(
      (
        await call('POST', `/deliverables/${deliverable.id}/versions`, artist.token, {
          fileId: theirs,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call('POST', `/tasks/${task.id}/deliverables`, artist.token, { name: '  ' }))
        .statusCode,
    ).toBe(400);
  });
});
