import { taskStatuses } from '@whiteboard/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  bearer,
  createTestHost,
  removeMember,
  seedUser,
  setupOwner,
  uploadTestFile,
  type TestHost,
} from '../test-helpers';

let host: TestHost;
let owner: { token: string; workspaceId: string };
beforeEach(async () => {
  host = createTestHost();
  owner = await setupOwner(host);
});
afterEach(() => host.cleanup());

type Person = Awaited<ReturnType<typeof seedUser>>;
const staff = (role: 'admin' | 'member' | 'guest' = 'member') =>
  seedUser(host.db, owner.workspaceId, role);

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token?: string,
  payload?: object,
) => host.app.inject({ method, url, payload, headers: token ? bearer(token) : undefined });

async function createProject(who: Person, body: object = { name: 'Logo for Client X' }) {
  const res = await call('POST', '/projects', who.token, body);
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; status: string; members: { userId: string; role: string }[] };
}

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

describe('creating projects', () => {
  it('lets staff create a project, makes them its manager and seeds the six task statuses', async () => {
    const manager = await staff();
    const brief = { type: 'doc', content: [{ type: 'paragraph' }] };
    const project = await createProject(manager, {
      name: '  Logo for Client X ',
      clientName: 'Client X',
      brief,
      deadline: Date.now() + 7 * 86_400_000,
      color: '#3366cc',
    });
    expect(project).toMatchObject({
      name: 'Logo for Client X',
      status: 'draft',
      myRole: 'manager',
    });
    expect(project.members).toEqual([
      expect.objectContaining({ userId: manager.id, role: 'manager' }),
    ]);

    const detail = (await call('GET', `/projects/${project.id}`, manager.token)).json();
    expect(detail.brief).toEqual(brief);

    const statuses = host.db
      .select()
      .from(taskStatuses)
      .where(eq(taskStatuses.projectId, project.id))
      .all();
    expect(statuses.map((s) => s.kind).sort()).toEqual(
      ['approved', 'changes', 'doing', 'done', 'review', 'todo'].sort(),
    );
  });

  it('refuses guests and anonymous users, and validates the body', async () => {
    const guest = await staff('guest');
    expect((await call('POST', '/projects', guest.token, { name: 'x' })).statusCode).toBe(403);
    expect((await call('POST', '/projects', undefined, { name: 'x' })).statusCode).toBe(401);
    const member = await staff();
    expect((await call('POST', '/projects', member.token, { name: ' ' })).statusCode).toBe(400);
    expect(
      (await call('POST', '/projects', member.token, { name: 'x', color: 'red' })).statusCode,
    ).toBe(400);
    const res = await call('POST', '/projects', member.token, {
      name: 'x',
      startDate: 2000,
      deadline: 1000,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('who can see a project', () => {
  it('shows each person only their own projects; admins and the owner see all', async () => {
    const a = await staff();
    const b = await staff();
    const admin = await staff('admin');
    const pa = await createProject(a, { name: 'A project' });
    const pb = await createProject(b, { name: 'B project' });

    const names = async (p: { token: string }) =>
      ((await call('GET', '/projects', p.token)).json() as { name: string }[])
        .map((x) => x.name)
        .sort();
    expect(await names(a)).toEqual(['A project']);
    expect(await names(b)).toEqual(['B project']);
    expect(await names(admin)).toEqual(['A project', 'B project']);
    expect(await names(owner)).toEqual(['A project', 'B project']);

    expect((await call('GET', `/projects/${pb.id}`, a.token)).statusCode).toBe(404);
    expect((await call('GET', `/projects/${pa.id}`, admin.token)).statusCode).toBe(200);
    expect((await call('GET', `/projects/${pa.id}`)).statusCode).toBe(401);
  });
});

describe('editing and status', () => {
  it('lets the manager edit, but not an artist', async () => {
    const manager = await staff();
    const artist = await staff('guest');
    const project = await createProject(manager);
    await call('POST', `/projects/${project.id}/members`, manager.token, {
      userId: artist.id,
      role: 'artist',
    });

    const ok = await call('PATCH', `/projects/${project.id}`, manager.token, { name: 'Renamed' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().name).toBe('Renamed');
    expect(
      (await call('PATCH', `/projects/${project.id}`, artist.token, { name: 'Hack' })).statusCode,
    ).toBe(403);
    expect((await call('PATCH', `/projects/${project.id}`, manager.token, {})).statusCode).toBe(
      400,
    );

    await call('PATCH', `/projects/${project.id}`, manager.token, {
      startDate: 5000,
      deadline: 9000,
    });
    const bad = await call('PATCH', `/projects/${project.id}`, manager.token, { deadline: 1000 });
    expect(bad.statusCode).toBe(400);
  });

  it('follows the status flow and records archiving', async () => {
    const manager = await staff();
    const project = await createProject(manager);
    const move = (status: string) =>
      call('POST', `/projects/${project.id}/status`, manager.token, { status });

    expect((await move('delivered')).statusCode).toBe(409); // draft -> delivered is not allowed
    expect((await move('active')).json().status).toBe('active');
    expect((await move('in_review')).json().status).toBe('in_review');
    expect((await move('delivered')).json().status).toBe('delivered');
    expect((await move('archived')).json().status).toBe('archived');
    expect((await move('delivered')).statusCode).toBe(409);
    expect((await move('active')).json().status).toBe('active'); // restore
    expect((await move('nonsense')).statusCode).toBe(400);
  });
});

describe('project members', () => {
  it('adds, lists and removes people, and gives members access', async () => {
    const manager = await staff();
    const artist = await staff('guest');
    const project = await createProject(manager);
    expect((await call('GET', `/projects/${project.id}`, artist.token)).statusCode).toBe(404);

    const add = await call('POST', `/projects/${project.id}/members`, manager.token, {
      userId: artist.id,
      role: 'artist',
    });
    expect(add.statusCode).toBe(201);
    expect(add.json().members).toHaveLength(2);
    expect(add.json().memberCount).toBe(2);
    expect((await call('GET', `/projects/${project.id}`, artist.token)).json().myRole).toBe(
      'artist',
    );

    const again = await call('POST', `/projects/${project.id}/members`, manager.token, {
      userId: artist.id,
      role: 'artist',
    });
    expect(again.statusCode).toBe(409);

    expect(
      (await call('DELETE', `/projects/${project.id}/members/${artist.id}`, manager.token))
        .statusCode,
    ).toBe(204);
    expect((await call('GET', `/projects/${project.id}`, artist.token)).statusCode).toBe(404);
  });

  it('keeps freelancers as artists, protects the last manager, and rejects unknown people', async () => {
    const manager = await staff();
    const guest = await staff('guest');
    const project = await createProject(manager);

    const asManager = await call('POST', `/projects/${project.id}/members`, manager.token, {
      userId: guest.id,
      role: 'manager',
    });
    expect(asManager.statusCode).toBe(400);
    const unknown = await call('POST', `/projects/${project.id}/members`, manager.token, {
      userId: 'nobody',
      role: 'artist',
    });
    expect(unknown.statusCode).toBe(404);
    const last = await call(
      'DELETE',
      `/projects/${project.id}/members/${manager.id}`,
      manager.token,
    );
    expect(last.statusCode).toBe(400);

    const second = await staff();
    await call('POST', `/projects/${project.id}/members`, manager.token, {
      userId: second.id,
      role: 'manager',
    });
    expect(
      (await call('DELETE', `/projects/${project.id}/members/${manager.id}`, second.token))
        .statusCode,
    ).toBe(204);
  });

  it('does not list removed workspace members, nor let them be added', async () => {
    const manager = await staff();
    const gone = await staff();
    const project = await createProject(manager);
    await call('POST', `/projects/${project.id}/members`, manager.token, {
      userId: gone.id,
      role: 'artist',
    });
    removeMember(host.db, gone.id);

    const detail = (await call('GET', `/projects/${project.id}`, manager.token)).json();
    expect(detail.members.map((m: { userId: string }) => m.userId)).toEqual([manager.id]);
    const other = await createProject(manager, { name: 'Another' });
    const res = await call('POST', `/projects/${other.id}/members`, manager.token, {
      userId: gone.id,
      role: 'artist',
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /people lists current people for staff only', async () => {
    const member = await staff();
    const guest = await staff('guest');
    const gone = await staff();
    removeMember(host.db, gone.id);

    const res = await call('GET', '/people', member.token);
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { id: string }[]).map((p) => p.id);
    expect(ids).toContain(guest.id);
    expect(ids).not.toContain(gone.id);
    expect((await call('GET', '/people', guest.token)).statusCode).toBe(403);
  });
});

describe('project files', () => {
  it('lets members read project files, and nobody else', async () => {
    const manager = await staff();
    const artist = await staff('guest');
    const outsider = await staff();
    const project = await createProject(manager);
    await call('POST', `/projects/${project.id}/members`, manager.token, {
      userId: artist.id,
      role: 'artist',
    });
    const fileId = await uploadTestFile(host, manager.token, 'brief.pdf', pdf);
    const read = (who: Person) => call('GET', `/files/${fileId}/content`, who.token);

    // Before it is attached, only the uploader (and admins) can read it.
    expect((await read(artist)).statusCode).toBe(404);

    const attach = await call('POST', `/projects/${project.id}/files`, manager.token, {
      fileId,
      kind: 'brief',
    });
    expect(attach.statusCode).toBe(201);
    expect(attach.json()).toEqual([
      expect.objectContaining({
        fileId,
        kind: 'brief',
        name: 'brief.pdf',
        mimeType: 'application/pdf',
      }),
    ]);

    expect((await read(artist)).statusCode).toBe(200);
    expect((await read(outsider)).statusCode).toBe(404);
    expect((await call('GET', `/files/${fileId}`, outsider.token)).statusCode).toBe(404);
    expect((await call('GET', `/projects/${project.id}/files`, artist.token)).json()).toHaveLength(
      1,
    );
    expect((await call('GET', `/projects/${project.id}/files`, outsider.token)).statusCode).toBe(
      404,
    );

    // Leaving the project ends access; so does detaching the file.
    await call('DELETE', `/projects/${project.id}/members/${artist.id}`, manager.token);
    expect((await read(artist)).statusCode).toBe(404);
    await call('POST', `/projects/${project.id}/members`, manager.token, {
      userId: artist.id,
      role: 'artist',
    });
    expect((await read(artist)).statusCode).toBe(200);
    expect(
      (await call('DELETE', `/projects/${project.id}/files/${fileId}`, manager.token)).statusCode,
    ).toBe(204);
    expect((await read(artist)).statusCode).toBe(404);
    expect((await read(manager)).statusCode).toBe(200); // still the uploader's file
  });

  it('only managers attach files, and only files they can already read', async () => {
    const manager = await staff();
    const artist = await staff('guest');
    const stranger = await staff();
    const project = await createProject(manager);
    await call('POST', `/projects/${project.id}/members`, manager.token, {
      userId: artist.id,
      role: 'artist',
    });
    const mine = await uploadTestFile(host, manager.token, 'a.pdf', pdf);
    const theirs = await uploadTestFile(host, stranger.token, 'b.pdf', pdf);

    expect(
      (await call('POST', `/projects/${project.id}/files`, artist.token, { fileId: mine }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('POST', `/projects/${project.id}/files`, manager.token, { fileId: theirs }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call('POST', `/projects/${project.id}/files`, manager.token, { fileId: 'nope' }))
        .statusCode,
    ).toBe(404);

    // Attaching twice just updates the kind.
    await call('POST', `/projects/${project.id}/files`, manager.token, { fileId: mine });
    const second = await call('POST', `/projects/${project.id}/files`, manager.token, {
      fileId: mine,
      kind: 'other',
    });
    expect(second.json()).toHaveLength(1);
    expect(second.json()[0].kind).toBe('other');
    expect(
      (await call('DELETE', `/projects/${project.id}/files/${theirs}`, manager.token)).statusCode,
    ).toBe(404);
  });
});
