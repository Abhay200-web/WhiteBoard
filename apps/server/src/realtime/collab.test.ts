import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import { boardItems, boardUpdates, projectMembers } from '@whiteboard/db';
import { count, eq } from 'drizzle-orm';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';

import { buildApp } from '../app';
import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';

let host: TestHost;
let owner: { token: string; workspaceId: string };
let port: number;
const open: Array<() => void> = [];

beforeEach(async () => {
  host = createTestHost({ collab: { debounceMs: 20, compactAfter: 5 } });
  owner = await setupOwner(host);
  await host.app.listen({ port: 0, host: '127.0.0.1' });
  port = (host.app.server.address() as AddressInfo).port;
});
afterEach(async () => {
  open.splice(0).forEach((close) => close());
  await host.cleanup();
});

const call = (method: 'GET' | 'POST', url: string, token: string, payload?: object) =>
  host.app.inject({ method, url, payload, headers: bearer(token) });

const until = async (check: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
  return check();
};

/** A project with a manager, an artist on it, and one child board on the main board. */
async function setUpBoard() {
  const manager = await seedUser(host.db, owner.workspaceId, 'member');
  const artist = await seedUser(host.db, owner.workspaceId, 'member');
  const project = (
    await call('POST', '/projects', manager.token, { name: 'Logo for Client X' })
  ).json() as { id: string };
  await call('POST', `/projects/${project.id}/members`, manager.token, {
    userId: artist.id,
    role: 'artist',
  });
  const root = (await call('GET', `/projects/${project.id}/boards/root`, manager.token)).json() as {
    id: string;
  };
  await call('POST', `/boards/${root.id}/boards`, manager.token, {
    title: 'Moodboard',
    x: 10,
    y: 20,
  });
  // The placement of that board on the root: the document and `board_items` are keyed by it.
  const detail = (await call('GET', `/boards/${root.id}`, manager.token)).json() as {
    items: { id: string }[];
  };
  return { manager, artist, rootId: root.id, itemId: detail.items[0]!.id };
}

/** Opens a live editor for a board, the way the web app will. */
async function editor(token: string, boardId: string) {
  const doc = new Y.Doc();
  let refused = false;
  const socket = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${port}/collab`,
    WebSocketPolyfill: WebSocket,
  });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `board:${boardId}`,
    document: doc,
    token,
    onAuthenticationFailed: () => {
      refused = true;
    },
  });
  // Given a socket of its own, the provider does not attach itself; attaching starts the sign-in.
  provider.attach();
  const close = () => {
    provider.destroy();
    socket.destroy();
  };
  open.push(close);
  return { doc, provider, close, refused: () => refused };
}

const itemsOf = (doc: Y.Doc) => doc.getMap<{ x: number }>('items');

describe('live editing', () => {
  it('shows one editor the changes another makes', async () => {
    const { manager, artist, rootId, itemId } = await setUpBoard();
    const a = await editor(manager.token, rootId);
    const b = await editor(artist.token, rootId);
    expect(await until(() => a.provider.isSynced && b.provider.isSynced)).toBe(true);
    expect(await until(() => itemsOf(b.doc).has(itemId))).toBe(true);

    const moved = itemsOf(a.doc).get(itemId)!;
    a.doc.transact(() => itemsOf(a.doc).set(itemId, { ...moved, x: 300 } as never));
    expect(await until(() => itemsOf(b.doc).get(itemId)?.x === 300)).toBe(true);
  });

  it('refuses a wrong token', async () => {
    const { rootId } = await setUpBoard();
    const stranger = await editor('not-a-token', rootId);
    expect(await until(() => stranger.refused())).toBe(true);
  });

  it('refuses someone who is not on the project', async () => {
    const { rootId } = await setUpBoard();
    const outsider = await seedUser(host.db, owner.workspaceId, 'member');
    const who = await editor(outsider.token, rootId);
    expect(await until(() => who.refused())).toBe(true);
  });

  it('writes the new layout to the board rows after a short delay', async () => {
    const { manager, rootId, itemId } = await setUpBoard();
    const a = await editor(manager.token, rootId);
    await until(() => a.provider.isSynced && itemsOf(a.doc).has(itemId));
    const moved = itemsOf(a.doc).get(itemId)!;
    a.doc.transact(() => itemsOf(a.doc).set(itemId, { ...moved, x: 411, y: 99 } as never));

    const row = () => host.db.select().from(boardItems).where(eq(boardItems.id, itemId)).get()!;
    expect(await until(() => row().x === 411)).toBe(true);
    expect(row().y).toBe(99);
  });

  it('keeps the layout after the Host restarts', async () => {
    const { manager, rootId, itemId } = await setUpBoard();
    const a = await editor(manager.token, rootId);
    await until(() => a.provider.isSynced && itemsOf(a.doc).has(itemId));
    const moved = itemsOf(a.doc).get(itemId)!;
    a.doc.transact(() => itemsOf(a.doc).set(itemId, { ...moved, x: 777 } as never));
    await until(
      () =>
        (host.db.select().from(boardItems).where(eq(boardItems.id, itemId)).get()?.x ?? 0) === 777,
    );
    a.close();

    // A new server on the same database, as after a restart.
    const restarted = buildApp({ db: host.db, dataDir: host.dataDir, collab: { debounceMs: 20 } });
    await restarted.listen({ port: 0, host: '127.0.0.1' });
    try {
      port = (restarted.server.address() as AddressInfo).port;
      const b = await editor(manager.token, rootId);
      expect(await until(() => b.provider.isSynced && itemsOf(b.doc).get(itemId)?.x === 777)).toBe(
        true,
      );
      b.close();
    } finally {
      await restarted.close();
    }
  }, 15_000);

  it('compacts many stored updates into one row', async () => {
    const { manager, rootId, itemId } = await setUpBoard();
    const a = await editor(manager.token, rootId);
    await until(() => a.provider.isSynced && itemsOf(a.doc).has(itemId));
    // Eight edits in one burst: each is stored as an update, then the debounced store compacts them.
    for (let x = 1; x <= 8; x++) {
      const moved = itemsOf(a.doc).get(itemId)!;
      a.doc.transact(() => itemsOf(a.doc).set(itemId, { ...moved, x } as never));
    }
    const rows = () =>
      host.db
        .select({ n: count() })
        .from(boardUpdates)
        .where(eq(boardUpdates.boardId, rootId))
        .get()!.n;
    expect(await until(() => rows() === 1)).toBe(true);
  });

  it('stops a removed member’s edits at the next change', async () => {
    const { manager, artist, rootId, itemId } = await setUpBoard();
    const member = await editor(artist.token, rootId);
    await until(() => member.provider.isSynced && itemsOf(member.doc).has(itemId));

    host.db.delete(projectMembers).where(eq(projectMembers.userId, artist.id)).run();

    const moved = itemsOf(member.doc).get(itemId)!;
    member.doc.transact(() => itemsOf(member.doc).set(itemId, { ...moved, x: 999 } as never));
    await new Promise((r) => setTimeout(r, 200));

    const reader = await editor(manager.token, rootId);
    await until(() => reader.provider.isSynced);
    expect(itemsOf(reader.doc).get(itemId)?.x).not.toBe(999);
  });
});
