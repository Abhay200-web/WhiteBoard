import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';

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

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, token?: string, payload?: object) =>
  host.app.inject({ method, url, payload, headers: token ? bearer(token) : undefined });

interface Detail {
  id: string;
  title: string;
  isRoot: boolean;
  breadcrumbs: { id: string; title: string }[];
  items: { childBoardId: string; title: string }[];
}

/** A manager creates a project, adds `artist` to it, and returns the project id. */
async function projectWith(manager: Person, artist?: Person) {
  const created = await call('POST', '/projects', manager.token, { name: 'Logo for Client X' });
  expect(created.statusCode).toBe(201);
  const projectId = (created.json() as { id: string }).id;
  if (artist) {
    const added = await call('POST', `/projects/${projectId}/members`, manager.token, {
      userId: artist.id,
      role: 'artist',
    });
    expect(added.statusCode).toBe(201);
  }
  return projectId;
}

async function rootOf(who: Person, projectId: string): Promise<Detail> {
  const res = await call('GET', `/projects/${projectId}/boards/root`, who.token);
  expect(res.statusCode).toBe(200);
  return res.json() as Detail;
}

describe('the root board', () => {
  it('is created on the first visit, named after the project, and is the same on every visit', async () => {
    const manager = await staff();
    const projectId = await projectWith(manager);

    const first = await rootOf(manager, projectId);
    expect(first).toMatchObject({ title: 'Logo for Client X', isRoot: true, items: [] });
    expect(first.breadcrumbs).toEqual([{ id: first.id, title: 'Logo for Client X' }]);

    const again = await rootOf(manager, projectId);
    expect(again.id).toBe(first.id);
  });

  it('is hidden from people who are not on the project', async () => {
    const manager = await staff();
    const outsider = await staff();
    const projectId = await projectWith(manager);
    const res = await call('GET', `/projects/${projectId}/boards/root`, outsider.token);
    expect(res.statusCode).toBe(404);
  });
});

describe('nesting, breadcrumbs and renaming', () => {
  it('puts a child board on its parent, with a trail back to the root', async () => {
    const manager = await staff();
    const projectId = await projectWith(manager);
    const root = await rootOf(manager, projectId);

    const made = await call('POST', `/boards/${root.id}/boards`, manager.token, {
      title: 'Moodboard',
      x: 40,
      y: 80,
    });
    expect(made.statusCode).toBe(201);
    const child = made.json() as { id: string; isRoot: boolean };
    expect(child.isRoot).toBe(false);

    const rootAgain = await rootOf(manager, projectId);
    expect(rootAgain.items).toEqual([
      expect.objectContaining({ childBoardId: child.id, title: 'Moodboard' }),
    ]);

    const inside = await call('GET', `/boards/${child.id}`, manager.token);
    const detail = inside.json() as Detail;
    expect(detail.breadcrumbs).toEqual([
      { id: root.id, title: 'Logo for Client X' },
      { id: child.id, title: 'Moodboard' },
    ]);
  });

  it('renames a board, and refuses an empty name', async () => {
    const manager = await staff();
    const projectId = await projectWith(manager);
    const root = await rootOf(manager, projectId);

    const renamed = await call('PATCH', `/boards/${root.id}`, manager.token, { title: 'Refs' });
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as { title: string }).title).toBe('Refs');

    const empty = await call('PATCH', `/boards/${root.id}`, manager.token, { title: '   ' });
    expect(empty.statusCode).toBe(400);
  });
});

describe('trash and restore', () => {
  it('moves a board to the trash, hides it, and restores it', async () => {
    const manager = await staff();
    const projectId = await projectWith(manager);
    const root = await rootOf(manager, projectId);
    const child = (
      await call('POST', `/boards/${root.id}/boards`, manager.token, { title: 'Old ideas' })
    ).json() as { id: string };

    const trashed = await call('POST', `/boards/${child.id}/trash`, manager.token);
    expect(trashed.statusCode).toBe(200);
    expect((trashed.json() as { trashedAt: number | null }).trashedAt).not.toBeNull();

    expect((await call('GET', `/boards/${child.id}`, manager.token)).statusCode).toBe(404);
    expect((await rootOf(manager, projectId)).items).toEqual([]);

    const bin = await call('GET', `/projects/${projectId}/boards/trash`, manager.token);
    expect((bin.json() as { id: string }[]).map((b) => b.id)).toEqual([child.id]);

    const restored = await call('POST', `/boards/${child.id}/restore`, manager.token);
    expect((restored.json() as { trashedAt: number | null }).trashedAt).toBeNull();
    expect((await call('GET', `/boards/${child.id}`, manager.token)).statusCode).toBe(200);
  });

  it('hides everything nested in a trashed board until that board is restored', async () => {
    const manager = await staff();
    const projectId = await projectWith(manager);
    const root = await rootOf(manager, projectId);
    const parent = (
      await call('POST', `/boards/${root.id}/boards`, manager.token, { title: 'Parent' })
    ).json() as { id: string };
    const grandchild = (
      await call('POST', `/boards/${parent.id}/boards`, manager.token, { title: 'Inside' })
    ).json() as { id: string };

    await call('POST', `/boards/${parent.id}/trash`, manager.token);
    expect((await call('GET', `/boards/${grandchild.id}`, manager.token)).statusCode).toBe(404);

    await call('POST', `/boards/${parent.id}/restore`, manager.token);
    expect((await call('GET', `/boards/${grandchild.id}`, manager.token)).statusCode).toBe(200);
  });

  it('never trashes a project’s main board', async () => {
    const manager = await staff();
    const projectId = await projectWith(manager);
    const root = await rootOf(manager, projectId);
    const res = await call('POST', `/boards/${root.id}/trash`, manager.token);
    expect(res.statusCode).toBe(400);
  });

  it('lets only a project manager trash or restore; an artist on the project may still create', async () => {
    const manager = await staff();
    const artist = await staff();
    const projectId = await projectWith(manager, artist);
    const root = await rootOf(manager, projectId);
    const child = (
      await call('POST', `/boards/${root.id}/boards`, artist.token, { title: 'Mine' })
    ).json() as { id: string };
    expect(child.id).toBeTruthy();

    const trash = await call('POST', `/boards/${child.id}/trash`, artist.token);
    expect(trash.statusCode).toBe(403);
  });

  it('keeps boards in other projects out of reach', async () => {
    const manager = await staff();
    const outsider = await staff();
    const projectId = await projectWith(manager);
    const root = await rootOf(manager, projectId);
    const res = await call('PATCH', `/boards/${root.id}`, outsider.token, { title: 'Hijacked' });
    expect(res.statusCode).toBe(404);
    // Owners see every project, so the owner can still reach it.
    expect((await call('GET', `/boards/${root.id}`, owner.token)).statusCode).toBe(200);
  });
});
