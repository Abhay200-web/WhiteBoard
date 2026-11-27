import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { Server } from '@hocuspocus/server';
import { itemGeometrySchema, type ItemGeometry } from '@whiteboard/core';
import { boardItems, boardUpdates, type Db } from '@whiteboard/db';
import { and, asc, count, eq } from 'drizzle-orm';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';

import { resolveSession, type AuthContext } from '../auth/sessions';
import { findViewableBoard } from '../boards/tree';
import { indexCards } from '../search/cardIndex';

/** A board's live document is named `board:<board id>`. */
export const BOARD_DOC_PREFIX = 'board:';

/** Once a board has this many stored updates, they are compacted into one. */
export const COMPACT_AFTER = 200;

export interface CollabOptions {
  /** Quiet time before a changed board is stored, in ms. */
  debounceMs?: number;
  /** Updates kept per board before they are compacted. */
  compactAfter?: number;
}

/** Who is connected, decided when they connect. */
interface Connected {
  actor: AuthContext;
}

const boardIdOf = (documentName: string) =>
  documentName.startsWith(BOARD_DOC_PREFIX) ? documentName.slice(BOARD_DOC_PREFIX.length) : null;

/**
 * Real-time editing of boards (Yjs through Hocuspocus), inside the Host server. Each board is one
 * Yjs document, stored as updates in `board_updates`. The document's `items` map holds the position
 * and size of each child board; on every store the Host copies those into `board_items` (the
 * projector), so the database always shows the latest layout.
 */
export function createCollab(db: Db, opts: CollabOptions = {}) {
  const debounce = opts.debounceMs ?? 2000;
  const compactAfter = opts.compactAfter ?? COMPACT_AFTER;

  const server = new Server<Connected>({
    quiet: true,
    stopOnSignals: false,
    debounce,
    maxDebounce: debounce * 5,

    async onAuthenticate({ token, documentName }) {
      const boardId = boardIdOf(documentName);
      const actor = token ? resolveSession(db, token) : null;
      if (!actor || !boardId || !findViewableBoard(db, actor, boardId)) {
        throw new Error('not allowed');
      }
      return { actor };
    },

    // A removed member or a revoked session loses edit rights at their next change, not only on
    // reconnect.
    async beforeHandleMessage({ context, documentName }) {
      const boardId = boardIdOf(documentName);
      if (!boardId || !findViewableBoard(db, context.actor, boardId)) {
        throw new Error('not allowed');
      }
    },

    async onLoadDocument({ documentName, document }) {
      const boardId = boardIdOf(documentName);
      if (!boardId) return document;
      const rows = db
        .select({ data: boardUpdates.data })
        .from(boardUpdates)
        .where(eq(boardUpdates.boardId, boardId))
        .orderBy(asc(boardUpdates.id))
        .all();
      for (const row of rows) Y.applyUpdate(document, new Uint8Array(row.data));

      // Child boards created through the REST API are added to the document if it is missing them.
      const items = document.getMap<ItemGeometry>('items');
      const children = db.select().from(boardItems).where(eq(boardItems.boardId, boardId)).all();
      document.transact(() => {
        for (const child of children) {
          if (!items.has(child.id)) {
            items.set(child.id, {
              childBoardId: child.childBoardId,
              x: child.x,
              y: child.y,
              width: child.width,
              height: child.height,
            });
          }
        }
      });
      return document;
    },

    async onChange({ documentName, update }) {
      const boardId = boardIdOf(documentName);
      if (!boardId) return;
      db.insert(boardUpdates)
        .values({ boardId, data: Buffer.from(update), createdAt: new Date() })
        .run();
    },

    async onStoreDocument({ documentName, document }) {
      const boardId = boardIdOf(documentName);
      if (!boardId) return;
      projectLayout(db, boardId, document);
      indexCards(db, boardId, document);
      compact(db, boardId, document, compactAfter);
    },
  });

  // Hocuspocus does not read the socket itself: the Host passes each connection in and forwards
  // its messages and close, as Hocuspocus's own adapters do.
  const wss = new WebSocketServer({ noServer: true });
  const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) =>
    wss.handleUpgrade(req, socket, head, (ws) => {
      const connection = server.hocuspocus.handleConnection(ws as never, req as never);
      ws.on('message', (data: Buffer) => connection.handleMessage(new Uint8Array(data)));
      ws.on('close', (code: number, reason: Buffer) =>
        connection.handleClose({ code, reason: reason.toString() }),
      );
      ws.on('pong', () => connection.touch());
    });

  return { server, handleUpgrade };
}

/** Copies each child board's geometry from the document into `board_items`. */
function projectLayout(db: Db, boardId: string, document: Y.Doc) {
  const items = document.getMap<unknown>('items');
  db.transaction((tx) => {
    for (const [id, value] of items.entries()) {
      const parsed = itemGeometrySchema.safeParse(value);
      if (!parsed.success) continue;
      const g = parsed.data;
      tx.update(boardItems)
        .set({ x: g.x, y: g.y, width: g.width, height: g.height })
        .where(and(eq(boardItems.id, id), eq(boardItems.boardId, boardId)))
        .run();
    }
  });
}

/** Replaces a board's many stored updates with one row holding the whole document. */
function compact(db: Db, boardId: string, document: Y.Doc, compactAfter: number) {
  const { n } = db
    .select({ n: count() })
    .from(boardUpdates)
    .where(eq(boardUpdates.boardId, boardId))
    .get()!;
  if (n < compactAfter) return;
  db.transaction((tx) => {
    tx.delete(boardUpdates).where(eq(boardUpdates.boardId, boardId)).run();
    tx.insert(boardUpdates)
      .values({
        boardId,
        data: Buffer.from(Y.encodeStateAsUpdate(document)),
        createdAt: new Date(),
      })
      .run();
  });
}
