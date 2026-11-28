import { boardUpdates } from '@whiteboard/db';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

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

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, token?: string, payload?: object) =>
  host.app.inject({ method, url, payload, headers: token ? bearer(token) : undefined });

const place = { x: 0, y: 0, width: 200, height: 100 };

/** A project led by `manager` (with `artist` on it) and its root board's id. */
async function rootBoard(manager: Person, artist?: Person) {
  const project = (await call('POST', '/projects', manager.token, { name: 'Brand' })).json() as {
    id: string;
  };
  if (artist) {
    await call('POST', `/projects/${project.id}/members`, manager.token, {
      userId: artist.id,
      role: 'artist',
    });
  }
  const root = (await call('GET', `/projects/${project.id}/boards/root`, manager.token)).json();
  return (root as { id: string }).id;
}

/** The cards in a board's stored document. */
function storedCards(boardId: string) {
  const doc = new Y.Doc();
  const rows = host.db
    .select({ data: boardUpdates.data })
    .from(boardUpdates)
    .where(eq(boardUpdates.boardId, boardId))
    .orderBy(asc(boardUpdates.id))
    .all();
  for (const row of rows) Y.applyUpdate(doc, new Uint8Array(row.data));
  return [...doc.getMap<Y.Map<unknown>>('cards').values()].map(
    (m) => m.toJSON() as Record<string, unknown>,
  );
}

describe('board templates', () => {
  it('lists the built-in templates and starts a new board with one', async () => {
    const manager = await staff();
    const boardId = await rootBoard(manager);
    const list = (await call('GET', '/board-templates', manager.token)).json() as {
      id: string;
      name: string;
      builtIn: boolean;
    }[];
    expect(list.map((t) => t.name)).toEqual(['Task flow', 'Moodboard', 'Brief', 'Retrospective']);
    expect(list.every((t) => t.builtIn)).toBe(true);

    const child = await call('POST', `/boards/${boardId}/boards`, manager.token, {
      title: 'Sprint',
      templateId: 'builtin:task-flow',
    });
    expect(child.statusCode).toBe(201);
    const cards = storedCards((child.json() as { id: string }).id);
    expect(cards.filter((c) => c.kind === 'column').map((c) => c.title)).toEqual([
      'To do',
      'In progress',
      'Done',
    ]);
    // Every card gets a fresh id, and the cards can be found in search at once.
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    expect(cards.some((c) => c.id === 'c0')).toBe(false);
    const found = (await call('GET', '/search?q=progress', manager.token)).json() as {
      kind: string;
    }[];
    expect(found.some((r) => r.kind === 'card')).toBe(true);

    const blank = await call('POST', `/boards/${boardId}/boards`, manager.token, {
      title: 'Empty',
    });
    expect(storedCards((blank.json() as { id: string }).id)).toEqual([]);
    const unknown = await call('POST', `/boards/${boardId}/boards`, manager.token, {
      templateId: 'builtin:nope',
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('saves a board as a template, keeping only cards that fit any project', async () => {
    const manager = await staff();
    const colleague = await staff();
    const boardId = await rootBoard(manager);
    const saved = await call('POST', '/board-templates', manager.token, {
      name: ' Pitch ',
      cards: [
        { ...place, id: 'a', kind: 'note', text: 'Opening line' },
        { ...place, id: 'b', kind: 'column', title: 'Review', statusId: 's1' },
        {
          ...place,
          id: 'c',
          kind: 'link',
          url: 'https://example.com',
          title: 'Ex',
          description: '',
        },
      ],
    });
    expect(saved.statusCode).toBe(201);
    expect(saved.json()).toMatchObject({ name: 'Pitch', builtIn: false, cardCount: 3 });
    const templateId = (saved.json() as { id: string }).id;

    // Everyone on staff sees it and can start a board with it.
    const list = (await call('GET', '/board-templates', colleague.token)).json() as {
      id: string;
      createdByName: string | null;
    }[];
    expect(list.find((t) => t.id === templateId)?.createdByName).toEqual(expect.any(String));
    const colleagueBoard = await rootBoard(colleague);
    const child = await call('POST', `/boards/${colleagueBoard}/boards`, colleague.token, {
      templateId,
    });
    const cards = storedCards((child.json() as { id: string }).id);
    expect(cards.map((c) => c.kind).sort()).toEqual(['column', 'link', 'note']);
    // The status link belonged to the first project.
    expect(cards.find((c) => c.kind === 'column')).not.toHaveProperty('statusId');

    // Pictures, files and tasks are not template material.
    const refused = await call('POST', '/board-templates', manager.token, {
      name: 'Pictures',
      cards: [{ ...place, id: 'p', kind: 'image', fileId: 'f1', name: 'a.png' }],
    });
    expect(refused.statusCode).toBe(400);
    expect(
      (await call('POST', `/boards/${boardId}/boards`, manager.token, { templateId })).statusCode,
    ).toBe(201);
  });

  it('keeps saved templates from freelancers, and lets only the saver or an admin delete one', async () => {
    const manager = await staff();
    const colleague = await staff();
    const admin = await staff('admin');
    const artist = await staff('guest');
    const boardId = await rootBoard(manager, artist);
    const save = async (name: string) =>
      (
        (
          await call('POST', '/board-templates', manager.token, {
            name,
            cards: [{ ...place, id: 'a', kind: 'note', text: 'Secret plan' }],
          })
        ).json() as { id: string }
      ).id;
    const first = await save('Plan');
    const second = await save('Other plan');

    const theirs = (await call('GET', '/board-templates', artist.token)).json() as {
      builtIn: boolean;
    }[];
    expect(theirs.every((t) => t.builtIn)).toBe(true);
    expect(
      (await call('POST', '/board-templates', artist.token, { name: 'x', cards: [] })).statusCode,
    ).toBe(403);
    // A freelancer may start a board with a built-in template, not a saved one.
    const builtIn = await call('POST', `/boards/${boardId}/boards`, artist.token, {
      templateId: 'builtin:brief',
    });
    expect(builtIn.statusCode).toBe(201);
    const saved = await call('POST', `/boards/${boardId}/boards`, artist.token, {
      templateId: first,
    });
    expect(saved.statusCode).toBe(404);

    expect((await call('DELETE', `/board-templates/${first}`, colleague.token)).statusCode).toBe(
      403,
    );
    expect((await call('DELETE', `/board-templates/${first}`, manager.token)).statusCode).toBe(204);
    expect((await call('DELETE', `/board-templates/${second}`, admin.token)).statusCode).toBe(204);
    expect((await call('DELETE', `/board-templates/${second}`, admin.token)).statusCode).toBe(404);
    const left = (await call('GET', '/board-templates', manager.token)).json() as {
      builtIn: boolean;
    }[];
    expect(left.every((t) => t.builtIn)).toBe(true);
  });
});
