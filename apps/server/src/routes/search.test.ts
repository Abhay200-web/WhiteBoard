import { boards } from '@whiteboard/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { indexCards } from '../search/cardIndex';
import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';
import { matchQuery } from './search';

let host: TestHost;
let owner: { token: string; workspaceId: string };
beforeEach(async () => {
  host = createTestHost();
  owner = await setupOwner(host);
});
afterEach(() => host.cleanup());

const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  token: string,
  payload?: object,
) => host.app.inject({ method, url, payload, headers: bearer(token) });

const search = (token: string, q: string) =>
  call('GET', `/search?q=${encodeURIComponent(q)}`, token).then(
    (r) => r.json() as { kind: string; title: string; snippet: string; boardId: string | null }[],
  );

describe('matchQuery', () => {
  it('turns words into prefix matches and drops punctuation', () => {
    expect(matchQuery('logo cl')).toBe('"logo"* "cl"*');
    expect(matchQuery('  ')).toBe('');
    expect(matchQuery('"; DROP')).toBe('"DROP"*');
  });
});

describe('search', () => {
  it('finds projects, tasks and comments on the person’s projects, with prefix matches', async () => {
    const manager = await seedUser(host.db, owner.workspaceId, 'member');
    const project = (
      await call('POST', '/projects', manager.token, {
        name: 'Logo for Client X',
        clientName: 'Acme',
      })
    ).json() as { id: string };
    const task = (
      await call('POST', `/projects/${project.id}/tasks`, manager.token, { title: 'Logo concepts' })
    ).json() as { id: string };
    await call('POST', `/tasks/${task.id}/comments`, manager.token, { body: 'Make it bold' });

    const logo = await search(manager.token, 'logo');
    expect(logo.map((h) => h.kind).sort()).toEqual(['project', 'task']);
    expect(await search(manager.token, 'conc')).toEqual([
      expect.objectContaining({ kind: 'task', title: 'Logo concepts' }),
    ]);
    expect(await search(manager.token, 'acme')).toEqual([
      expect.objectContaining({ kind: 'project' }),
    ]);

    const comment = await search(manager.token, 'bold');
    expect(comment).toEqual([expect.objectContaining({ kind: 'comment', title: 'Logo concepts' })]);
    expect(comment[0]!.snippet).toContain('[bold]');
  });

  it('shows nothing from projects the person is not on', async () => {
    const manager = await seedUser(host.db, owner.workspaceId, 'member');
    const outsider = await seedUser(host.db, owner.workspaceId, 'member');
    await call('POST', '/projects', manager.token, { name: 'Secret launch' });
    expect(await search(outsider.token, 'secret')).toEqual([]);
    expect(await search(manager.token, 'secret')).toHaveLength(1);
  });

  it('keeps the index current when things are renamed or removed', async () => {
    const manager = await seedUser(host.db, owner.workspaceId, 'member');
    const project = (
      await call('POST', '/projects', manager.token, { name: 'Old name' })
    ).json() as { id: string };
    const task = (
      await call('POST', `/projects/${project.id}/tasks`, manager.token, { title: 'Draft' })
    ).json() as { id: string };

    await call('PATCH', `/projects/${project.id}`, manager.token, { name: 'New name' });
    expect(await search(manager.token, 'old')).toEqual([]);
    expect(await search(manager.token, 'new')).toHaveLength(1);

    await call('DELETE', `/tasks/${task.id}`, manager.token);
    expect(await search(manager.token, 'draft')).toEqual([]);
  });

  it('finds words on a board: notes and titles, and drops them when the card is removed', async () => {
    const manager = await seedUser(host.db, owner.workspaceId, 'member');
    const project = (await call('POST', '/projects', manager.token, { name: 'Boards' })).json() as {
      id: string;
    };
    const root = (
      await call('GET', `/projects/${project.id}/boards/root`, manager.token)
    ).json() as { id: string };

    const doc = new Y.Doc();
    const cards = doc.getMap<Y.Map<unknown>>('cards');
    const note = new Y.Map<unknown>([
      ['id', 'n1'],
      ['kind', 'note'],
      ['x', 0],
      ['y', 0],
      ['width', 10],
      ['height', 10],
      ['text', 'Palette of warm sand tones'],
    ]);
    cards.set('n1', note);
    indexCards(host.db, root.id, doc);

    expect(await search(manager.token, 'sand')).toEqual([
      expect.objectContaining({ kind: 'card', boardId: root.id, title: '' }),
    ]);

    cards.delete('n1');
    indexCards(host.db, root.id, doc);
    expect(await search(manager.token, 'sand')).toEqual([]);
    expect(host.db.select().from(boards).where(eq(boards.id, root.id)).get()).toBeTruthy();
  });
});
