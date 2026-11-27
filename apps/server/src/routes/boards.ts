import { randomUUID } from 'node:crypto';

import {
  BOARD_ITEM_SIZE,
  boardDetailSchema,
  boardListSchema,
  boardSchema,
  createBoardRequestSchema,
  updateBoardRequestSchema,
  type Board,
} from '@whiteboard/core';
import { boardItems, boards, projects, type Db } from '@whiteboard/db';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { authenticate, badRequest, requireRole, sendError, ALL_ROLES } from '../plugins/auth';
import { canManageProject, canViewProject } from '../projects/access';

type BoardRow = typeof boards.$inferSelect;

export const boardRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];

  function summary(row: BoardRow): Board {
    return boardSchema.parse({
      id: row.id,
      projectId: row.projectId,
      title: row.title,
      isRoot: row.isRoot,
      createdBy: row.createdBy,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      trashedAt: row.trashedAt?.getTime() ?? null,
    });
  }

  /** The board that `boardId` sits on, or null for a root board. */
  function parentOf(boardId: string): BoardRow | null {
    const link = db
      .select({ boardId: boardItems.boardId })
      .from(boardItems)
      .where(eq(boardItems.childBoardId, boardId))
      .get();
    if (!link) return null;
    return db.select().from(boards).where(eq(boards.id, link.boardId)).get() ?? null;
  }

  /** The chain from the project's root board down to `row` (inclusive). */
  function trail(row: BoardRow): BoardRow[] {
    const chain: BoardRow[] = [row];
    for (let up = parentOf(row.id); up; up = parentOf(up.id)) chain.unshift(up);
    return chain;
  }

  function itemsOf(boardId: string) {
    return db
      .select({ item: boardItems, child: boards })
      .from(boardItems)
      .innerJoin(boards, eq(boards.id, boardItems.childBoardId))
      .where(and(eq(boardItems.boardId, boardId), isNull(boards.trashedAt)))
      .all()
      .map(({ item, child }) => ({
        id: item.id,
        kind: item.kind,
        childBoardId: item.childBoardId,
        title: child.title,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
      }));
  }

  function detail(chain: BoardRow[]) {
    const row = chain[chain.length - 1]!;
    return boardDetailSchema.parse({
      ...summary(row),
      breadcrumbs: chain.map((b) => ({ id: b.id, title: b.title })),
      items: itemsOf(row.id),
    });
  }

  /**
   * Loads a board the caller may view. Replies 404 for unknown boards, for boards in other
   * people's projects (no probing for ids), and for boards in the trash or nested in a trashed
   * board (`includeTrashed` lets restore reach the trashed board itself, not one above it).
   */
  function loadBoard(
    request: FastifyRequest,
    reply: FastifyReply,
    { includeTrashed = false }: { includeTrashed?: boolean } = {},
  ): { row: BoardRow; chain: BoardRow[] } | null {
    const { id } = request.params as { id: string };
    const row = db.select().from(boards).where(eq(boards.id, id)).get();
    if (!row || !canViewProject(db, request.auth!, row.projectId)) {
      void sendError(reply, 404, 'not_found', 'Board not found');
      return null;
    }
    const chain = trail(row);
    const above = chain.slice(0, -1).some((b) => b.trashedAt);
    if (above || (row.trashedAt && !includeTrashed)) {
      void sendError(reply, 404, 'not_found', 'Board not found');
      return null;
    }
    return { row, chain };
  }

  /** Trash and restore are for project managers and admins, not every viewer. */
  function requireManager(request: FastifyRequest, reply: FastifyReply, projectId: string) {
    if (canManageProject(db, request.auth!, projectId)) return true;
    void sendError(reply, 403, 'forbidden', 'Only a project manager can do this');
    return false;
  }

  // The root board is created on the first visit to the project, so no project is left without one.
  app.get('/projects/:id/boards/root', { preHandler: signedIn }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!project || !canViewProject(db, request.auth!, project.id)) {
      return sendError(reply, 404, 'not_found', 'Project not found');
    }
    const now = new Date();
    // The unique index on root boards makes a race between two first visits harmless.
    db.insert(boards)
      .values({
        id: randomUUID(),
        projectId: project.id,
        title: project.name,
        isRoot: true,
        createdBy: request.auth!.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
    const root = db
      .select()
      .from(boards)
      .where(and(eq(boards.projectId, project.id), eq(boards.isRoot, true)))
      .get()!;
    return detail([root]);
  });

  app.get('/projects/:id/boards/trash', { preHandler: signedIn }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!canViewProject(db, request.auth!, id)) {
      return sendError(reply, 404, 'not_found', 'Project not found');
    }
    const rows = db
      .select()
      .from(boards)
      .where(and(eq(boards.projectId, id), eq(boards.isRoot, false), isNotNull(boards.trashedAt)))
      .orderBy(desc(boards.trashedAt))
      .all();
    return boardListSchema.parse(rows.map(summary));
  });

  app.get('/boards/:id', { preHandler: signedIn }, async (request, reply) => {
    const loaded = loadBoard(request, reply);
    if (!loaded) return;
    return detail(loaded.chain);
  });

  app.post('/boards/:id/boards', { preHandler: signedIn }, async (request, reply) => {
    const parsed = createBoardRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const loaded = loadBoard(request, reply);
    if (!loaded) return;
    const parent = loaded.row;

    const now = new Date();
    const child = {
      id: randomUUID(),
      projectId: parent.projectId,
      title: parsed.data.title,
      isRoot: false,
      createdBy: request.auth!.user.id,
      createdAt: now,
      updatedAt: now,
    };
    db.transaction((tx) => {
      tx.insert(boards).values(child).run();
      tx.insert(boardItems)
        .values({
          id: randomUUID(),
          boardId: parent.id,
          kind: 'board',
          childBoardId: child.id,
          x: parsed.data.x,
          y: parsed.data.y,
          width: BOARD_ITEM_SIZE.width,
          height: BOARD_ITEM_SIZE.height,
        })
        .run();
    });
    const row = db.select().from(boards).where(eq(boards.id, child.id)).get()!;
    return reply.code(201).send(summary(row));
  });

  app.patch('/boards/:id', { preHandler: signedIn }, async (request, reply) => {
    const parsed = updateBoardRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const loaded = loadBoard(request, reply);
    if (!loaded) return;
    db.update(boards)
      .set({ title: parsed.data.title, updatedAt: new Date() })
      .where(eq(boards.id, loaded.row.id))
      .run();
    return summary(db.select().from(boards).where(eq(boards.id, loaded.row.id)).get()!);
  });

  app.post('/boards/:id/trash', { preHandler: signedIn }, async (request, reply) => {
    const loaded = loadBoard(request, reply);
    if (!loaded) return;
    const { row } = loaded;
    if (!requireManager(request, reply, row.projectId)) return;
    if (row.isRoot) return badRequest(reply, 'A project’s main board cannot be moved to the trash');
    const now = new Date();
    db.update(boards).set({ trashedAt: now, updatedAt: now }).where(eq(boards.id, row.id)).run();
    return summary(db.select().from(boards).where(eq(boards.id, row.id)).get()!);
  });

  app.post('/boards/:id/restore', { preHandler: signedIn }, async (request, reply) => {
    const loaded = loadBoard(request, reply, { includeTrashed: true });
    if (!loaded) return;
    const { row } = loaded;
    if (!requireManager(request, reply, row.projectId)) return;
    if (row.trashedAt) {
      db.update(boards)
        .set({ trashedAt: null, updatedAt: new Date() })
        .where(eq(boards.id, row.id))
        .run();
    }
    return summary(db.select().from(boards).where(eq(boards.id, row.id)).get()!);
  });
};
