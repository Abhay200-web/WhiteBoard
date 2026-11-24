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
type Version = { id: string; number: number };
type Deliverable = { id: string; versions: Version[] };
type Pin = { id: string; number: number; state: string; page: number; x: number; y: number };
type Comment = { id: string; authorId: string; body: string };
type Task = { id: string };

let host: TestHost;
let manager: Person;
let artist: Person;
let colleague: Person;
let outsider: Person;
let projectId: string;

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, token?: string, payload?: object) =>
  host.app.inject({ method, url, payload, headers: token ? bearer(token) : undefined });

/** A task assigned to `artist`, with one submitted version. Returns the version id. */
async function submittedVersion(): Promise<string> {
  const task = (
    await call('POST', `/projects/${projectId}/tasks`, manager.token, {
      title: 'Poster',
      assigneeIds: [artist.id],
    })
  ).json() as Task;
  const deliverable = (
    await call('POST', `/tasks/${task.id}/deliverables`, artist.token, { name: 'Poster' })
  ).json() as Deliverable;
  const fileId = await uploadTestFile(host, artist.token, 'poster.pdf', PDF);
  const sent = (
    await call('POST', `/deliverables/${deliverable.id}/versions`, artist.token, { fileId })
  ).json() as Deliverable;
  return sent.versions[0]!.id;
}

const dropPin = (versionId: string, token: string, x = 0.25, y = 0.5) =>
  call('POST', `/versions/${versionId}/pins`, token, { page: 2, x, y });

beforeEach(async () => {
  host = createTestHost();
  const owner = await setupOwner(host);
  manager = await seedUser(host.db, owner.workspaceId, 'member');
  artist = await seedUser(host.db, owner.workspaceId, 'guest');
  colleague = await seedUser(host.db, owner.workspaceId, 'guest');
  outsider = await seedUser(host.db, owner.workspaceId, 'member');
  projectId = (await call('POST', '/projects', manager.token, { name: 'Brand' })).json().id;
  for (const member of [artist, colleague]) {
    await call('POST', `/projects/${projectId}/members`, manager.token, {
      userId: member.id,
      role: 'artist',
    });
  }
});
afterEach(() => host.cleanup());

describe('pins on a version', () => {
  it('numbers pins 1, 2 per version, with page and position, open at first', async () => {
    const versionId = await submittedVersion();
    const first = await dropPin(versionId, manager.token, 0.1, 0.2);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      number: 1,
      page: 2,
      x: 0.1,
      y: 0.2,
      state: 'open',
      createdBy: manager.id,
    });
    expect((await dropPin(versionId, artist.token)).json()).toMatchObject({ number: 2 });

    const list = await call('GET', `/versions/${versionId}/pins`, colleague.token);
    expect((list.json() as Pin[]).map((p) => p.number)).toEqual([1, 2]);
  });

  it('refuses positions outside the page', async () => {
    const versionId = await submittedVersion();
    expect((await dropPin(versionId, manager.token, 1.5, 0.5)).statusCode).toBe(400);
  });

  it('hides pins from people who cannot see the task', async () => {
    const versionId = await submittedVersion();
    expect((await dropPin(versionId, outsider.token)).statusCode).toBe(404);
    expect((await call('GET', `/versions/${versionId}/pins`, outsider.token)).statusCode).toBe(404);
    expect((await dropPin('no-such-version', manager.token)).statusCode).toBe(404);
  });

  it('lets the artist resolve, but only a manager reopen; a colleague who is not assigned cannot resolve', async () => {
    const versionId = await submittedVersion();
    const pin = (await dropPin(versionId, manager.token)).json() as Pin;
    const url = `/pins/${pin.id}`;

    expect((await call('PATCH', url, colleague.token, { state: 'resolved' })).statusCode).toBe(403);
    const resolved = await call('PATCH', url, artist.token, { state: 'resolved' });
    expect(resolved.json()).toMatchObject({ state: 'resolved' });

    expect((await call('PATCH', url, artist.token, { state: 'open' })).statusCode).toBe(403);
    expect((await call('PATCH', url, manager.token, { state: 'open' })).json()).toMatchObject({
      state: 'open',
    });
  });

  it('keeps a thread per pin, oldest first, and refuses an empty message', async () => {
    const versionId = await submittedVersion();
    const pin = (await dropPin(versionId, manager.token)).json() as Pin;
    const url = `/pins/${pin.id}/comments`;

    await call('POST', url, manager.token, { body: 'Move the logo left' });
    const res = await call('POST', url, artist.token, { body: 'Done' });
    expect(res.statusCode).toBe(201);
    expect((res.json() as Comment[]).map((c) => [c.authorId, c.body])).toEqual([
      [manager.id, 'Move the logo left'],
      [artist.id, 'Done'],
    ]);
    expect((await call('POST', url, artist.token, { body: '  ' })).statusCode).toBe(400);
    expect((await call('GET', url, colleague.token)).json()).toHaveLength(2);
  });

  it('hides pin threads from people who cannot see the task', async () => {
    const versionId = await submittedVersion();
    const pin = (await dropPin(versionId, manager.token)).json() as Pin;
    const url = `/pins/${pin.id}/comments`;
    expect((await call('GET', url, outsider.token)).statusCode).toBe(404);
    expect((await call('POST', url, outsider.token, { body: 'hi' })).statusCode).toBe(404);
    expect(
      (await call('PATCH', `/pins/${pin.id}`, outsider.token, { state: 'resolved' })).statusCode,
    ).toBe(404);
  });
});
