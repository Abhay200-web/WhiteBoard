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
type Version = {
  id: string;
  number: number;
  state: string;
  note: string | null;
  submittedBy: string;
};
type Deliverable = { id: string; name: string; versions: Version[] };
type Task = { id: string; statusId: string };

let host: TestHost;
let manager: Person;
let artist: Person;
let outsider: Person;
let projectId: string;
let statuses: Record<string, Status>;

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  token?: string,
  payload?: object,
) => host.app.inject({ method, url, payload, headers: token ? bearer(token) : undefined });

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

describe('reviews', () => {
  async function submit(taskId: string, token: string, file: string, deliverableId?: string) {
    const id =
      deliverableId ??
      (
        (
          await call('POST', `/tasks/${taskId}/deliverables`, token, { name: 'Poster' })
        ).json() as Deliverable
      ).id;
    const fileId = await uploadTestFile(host, token, file, PDF);
    const res = await call('POST', `/deliverables/${id}/versions`, token, { fileId });
    expect(res.statusCode).toBe(201);
    return res.json() as Deliverable;
  }

  const review = (versionId: string, token: string, payload: object) =>
    call('POST', `/versions/${versionId}/reviews`, token, payload);

  it('approves a version: the task moves to Approved, the artist hears, history records it', async () => {
    const task = await createTask();
    const deliverable = await submit(task.id, artist.token, 'v1.pdf');
    const versionId = deliverable.versions[0]!.id;

    const res = await review(versionId, manager.token, { decision: 'approve', summary: 'Great' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      versions: [
        {
          state: 'approved',
          review: { decision: 'approve', reviewerName: expect.any(String), summary: 'Great' },
        },
      ],
    });
    expect(await currentStatus(task.id)).toBe(statuses.approved!.id);

    const { items } = (await call('GET', '/notifications', artist.token)).json() as {
      items: { kind: string; detail: string | null }[];
    };
    expect(items).toContainEqual(expect.objectContaining({ kind: 'status', detail: 'Approved' }));
    const history = (await call('GET', `/tasks/${task.id}/history`, manager.token)).json();
    expect(history).toContainEqual(
      expect.objectContaining({
        event: 'reviewed',
        name: 'Poster',
        number: 1,
        decision: 'approve',
      }),
    );
  });

  it('asks for changes with a summary: the task moves to Changes requested and a new version can follow', async () => {
    const task = await createTask();
    const deliverable = await submit(task.id, artist.token, 'v1.pdf');

    const bare = await review(deliverable.versions[0]!.id, manager.token, { decision: 'changes' });
    expect(bare.statusCode).toBe(400);

    const res = await review(deliverable.versions[0]!.id, manager.token, {
      decision: 'changes',
      summary: 'Logo too small',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      versions: [{ state: 'changes', review: { decision: 'changes', summary: 'Logo too small' } }],
    });
    expect(await currentStatus(task.id)).toBe(statuses.changes!.id);

    const next = await submit(task.id, artist.token, 'v2.pdf', deliverable.id);
    expect(next.versions.map((v) => [v.number, v.state])).toEqual([
      [1, 'changes'],
      [2, 'pending'],
    ]);
    expect(await currentStatus(task.id)).toBe(statuses.review!.id);
  });

  it('refuses an artist, a stranger, and a manager reviewing their own submission', async () => {
    const task = await createTask();
    const deliverable = await submit(task.id, artist.token, 'v1.pdf');
    const versionId = deliverable.versions[0]!.id;
    const payload = { decision: 'approve' };

    expect((await review(versionId, artist.token, payload)).statusCode).toBe(403);
    expect((await review(versionId, outsider.token, payload)).statusCode).toBe(404);

    // A manager who also works on a task sends a version; they cannot approve it themselves.
    const mine = await createTask();
    await call('PUT', `/tasks/${mine.id}/assignees`, manager.token, {
      userIds: [artist.id, manager.id],
    });
    const own = await submit(mine.id, manager.token, 'mine.pdf');
    const ownRes = await review(own.versions[0]!.id, manager.token, payload);
    expect(ownRes.statusCode).toBe(403);
    expect(await currentStatus(mine.id)).toBe(statuses.review!.id);
  });

  it('refuses a second decision, a decision on an older version, and a task that is not in review', async () => {
    const task = await createTask();
    const deliverable = await submit(task.id, artist.token, 'v1.pdf');
    const firstId = deliverable.versions[0]!.id;
    await review(firstId, manager.token, { decision: 'changes', summary: 'Again' });

    // Not in review any more: the task waits for the artist.
    expect((await review(firstId, manager.token, { decision: 'approve' })).statusCode).toBe(409);

    // A newer version is in review; the older one can no longer be decided.
    const second = await submit(task.id, artist.token, 'v2.pdf', deliverable.id);
    const secondId = second.versions[1]!.id;
    expect((await review(firstId, manager.token, { decision: 'approve' })).statusCode).toBe(409);
    expect((await review(secondId, manager.token, { decision: 'approve' })).statusCode).toBe(201);
    expect((await review(secondId, manager.token, { decision: 'approve' })).statusCode).toBe(409);
  });

  it('404s on an unknown version', async () => {
    expect((await review('nope', manager.token, { decision: 'approve' })).statusCode).toBe(404);
  });
});

describe('version compare', () => {
  const compare = (token: string, a: string, b: string) =>
    call('GET', `/versions/compare?a=${a}&b=${b}`, token);

  /** Sends one file as a new version of the deliverable; returns the version's id. */
  async function sendVersion(
    taskId: string,
    token: string,
    file: string,
    deliverableId?: string,
  ): Promise<{ deliverableId: string; versionId: string }> {
    const id =
      deliverableId ??
      (
        (
          await call('POST', `/tasks/${taskId}/deliverables`, token, { name: 'Poster' })
        ).json() as Deliverable
      ).id;
    const fileId = await uploadTestFile(host, token, file, PDF);
    const res = await call('POST', `/deliverables/${id}/versions`, token, { fileId });
    expect(res.statusCode).toBe(201);
    const versions = (res.json() as Deliverable).versions;
    return { deliverableId: id, versionId: versions[versions.length - 1]!.id };
  }

  it('returns two versions of one deliverable side by side, for people who see the task', async () => {
    const task = await createTask();
    const first = await sendVersion(task.id, artist.token, 'v1.pdf');
    await call('PATCH', `/tasks/${task.id}`, manager.token, { statusId: statuses.changes!.id });
    const second = await sendVersion(task.id, artist.token, 'v2.pdf', first.deliverableId);

    const res = await compare(manager.token, first.versionId, second.versionId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      deliverable: 'Poster',
      a: { number: 1, name: 'v1.pdf' },
      b: { number: 2, name: 'v2.pdf' },
    });
  });

  it('refuses versions of different deliverables, and hides them from outsiders', async () => {
    const poster = await sendVersion((await createTask()).id, artist.token, 'poster.pdf');
    const logo = await sendVersion((await createTask()).id, artist.token, 'logo.pdf');

    expect((await compare(manager.token, poster.versionId, logo.versionId)).statusCode).toBe(400);
    // Outsiders get 404 for any of them, whether or not the versions exist.
    expect((await compare(outsider.token, poster.versionId, poster.versionId)).statusCode).toBe(
      404,
    );
    expect((await compare(outsider.token, poster.versionId, logo.versionId)).statusCode).toBe(404);
    expect((await compare(manager.token, poster.versionId, 'nope')).statusCode).toBe(404);
  });

  it('needs both ids', async () => {
    expect((await call('GET', '/versions/compare?a=x', manager.token)).statusCode).toBe(400);
  });
});
