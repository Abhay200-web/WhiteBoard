import { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import { getHostUrl, getToken } from './api';

/** Someone else looking at the same board. */
export interface Person {
  name: string;
  color: string;
}

export interface LiveBoard {
  doc: Y.Doc;
  /** The first copy from the Host has arrived, so the board on screen is current. */
  synced: boolean;
  /** Connected to the Host right now. */
  online: boolean;
  /** Other people on this board right now. */
  peers: Person[];
}

/** The Host's `/collab` address: same origin in dev (the dev server forwards it), else the Host. */
function collabUrl(): string {
  const base = getHostUrl() || window.location.origin;
  return `${base.replace(/^http/, 'ws')}/collab`;
}

/**
 * Opens a board's live document and keeps it in sync until the page goes away. Changes are kept in
 * this browser (IndexedDB) too, so the board still opens, and edits are sent once the Host is back.
 */
export function useLiveBoard(boardId: string, me: Person): LiveBoard | null {
  const [live, setLive] = useState<LiveBoard | null>(null);
  const { name, color } = me;

  useEffect(() => {
    const doc = new Y.Doc();
    const docName = `board:${boardId}`;
    const cache = new IndexeddbPersistence(docName, doc);
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: docName,
      document: doc,
      token: getToken() ?? '',
    });
    const awareness = provider.awareness;
    awareness?.setLocalStateField('user', { name, color });

    const patch = (change: Partial<LiveBoard>) =>
      setLive((cur) => (cur ? { ...cur, ...change } : cur));
    const readPeers = () => {
      const seen = new Map<string, Person>();
      awareness?.getStates().forEach((state, clientId) => {
        const user = (state as { user?: Person }).user;
        if (clientId !== awareness.clientID && user) seen.set(user.name + user.color, user);
      });
      patch({ peers: [...seen.values()] });
    };

    provider.on('synced', () => patch({ synced: true }));
    provider.on('status', ({ status }: { status: string }) =>
      patch({ online: status === 'connected' }),
    );
    awareness?.on('change', readPeers);
    setLive({ doc, synced: false, online: false, peers: [] });

    return () => {
      awareness?.off('change', readPeers);
      provider.destroy();
      void cache.destroy();
      doc.destroy();
    };
  }, [boardId, name, color]);

  return live;
}

/** A stable colour for a person, so their pointer and name look the same on every screen. */
export function colorFor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 70% 45%)`;
}
