import { randomUUID } from 'node:crypto';

import {
  pinCommentListSchema,
  pinCommentRequestSchema,
  pinListSchema,
  pinRequestSchema,
  pinStateRequestSchema,
  type PinState,
} from '@whiteboard/core';
import {
  deliverableVersions,
  deliverables,
  pinComments,
  pins,
  users,
  type Db,
} from '@whiteboard/db';
import { asc, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { ALL_ROLES, authenticate, badRequest, requireRole, sendError } from '../plugins/auth';
import { canManageProject } from '../projects/access';
import { taskAccess } from '../projects/taskAccess';

/**
 * Numbered pins on a version's preview, and each pin's thread. Anyone who can see the task may
 * pin and comment. Artists (assignees) and managers resolve a pin; only managers reopen one.
 */
export const pinRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];
  const { loadTask, isAssignee, paramId } = taskAccess(db);

  /** The task a version belongs to. */
  const versionTask = (versionId: string) =>
    db
      .select({ taskId: deliverables.taskId })
      .from(deliverableVersions)
      .innerJoin(deliverables, eq(deliverables.id, deliverableVersions.deliverableId))
      .where(eq(deliverableVersions.id, versionId))
      .get();

  /** Pins matching `where`, oldest number first. */
  function readPins(where: SQL | undefined) {
    return pinListSchema.parse(
      db
        .select({
          id: pins.id,
          versionId: pins.versionId,
          number: pins.number,
          page: pins.page,
          x: pins.x,
          y: pins.y,
          state: pins.state,
          createdBy: pins.createdBy,
          createdByName: users.name,
          createdAt: pins.createdAt,
        })
        .from(pins)
        .innerJoin(users, eq(users.id, pins.createdBy))
        .where(where)
        .orderBy(asc(pins.number))
        .all()
        .map((p) => ({ ...p, createdAt: p.createdAt.getTime() })),
    );
  }

  function readThread(pinId: string) {
    return pinCommentListSchema.parse(
      db
        .select({
          id: pinComments.id,
          pinId: pinComments.pinId,
          authorId: pinComments.authorId,
          authorName: users.name,
          body: pinComments.body,
          createdAt: pinComments.createdAt,
        })
        .from(pinComments)
        .innerJoin(users, eq(users.id, pinComments.authorId))
        .where(eq(pinComments.pinId, pinId))
        .orderBy(asc(pinComments.createdAt), sql`${pinComments}.rowid`)
        .all()
        .map((c) => ({ ...c, createdAt: c.createdAt.getTime() })),
    );
  }

  /** A pin and its task, after the caller has been checked against the task. 404 otherwise. */
  function loadPin(request: FastifyRequest, reply: FastifyReply) {
    const pin = db
      .select()
      .from(pins)
      .where(eq(pins.id, paramId(request)))
      .get();
    const owner = pin && versionTask(pin.versionId);
    if (!pin || !owner) {
      void sendError(reply, 404, 'not_found', 'Pin not found');
      return null;
    }
    const task = loadTask(request, reply, 'view', owner.taskId);
    return task ? { pin, task } : null;
  }

  app.get('/versions/:id/pins', { preHandler: signedIn }, async (request, reply) => {
    const version = versionTask(paramId(request));
    if (!version) return sendError(reply, 404, 'not_found', 'Version not found');
    if (!loadTask(request, reply, 'view', version.taskId)) return;
    return readPins(eq(pins.versionId, paramId(request)));
  });

  app.post('/versions/:id/pins', { preHandler: signedIn }, async (request, reply) => {
    const versionId = paramId(request);
    const version = versionTask(versionId);
    if (!version) return sendError(reply, 404, 'not_found', 'Version not found');
    if (!loadTask(request, reply, 'view', version.taskId)) return;
    const parsed = pinRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);

    const id = randomUUID();
    db.transaction((tx) => {
      const { latest } = tx
        .select({ latest: sql<number>`coalesce(max(${pins.number}), 0)` })
        .from(pins)
        .where(eq(pins.versionId, versionId))
        .get()!;
      tx.insert(pins)
        .values({
          id,
          versionId,
          number: latest + 1,
          ...parsed.data,
          state: 'open',
          createdBy: request.auth!.user.id,
          createdAt: new Date(),
        })
        .run();
    });
    return reply.code(201).send(readPins(eq(pins.id, id))[0]);
  });

  app.patch('/pins/:id', { preHandler: signedIn }, async (request, reply) => {
    const found = loadPin(request, reply);
    if (!found) return;
    const parsed = pinStateRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const auth = request.auth!;
    const { pin, task } = found;
    const manager = canManageProject(db, auth, task.projectId);
    const state: PinState = parsed.data.state;
    if (state === 'open' && !manager) {
      return sendError(reply, 403, 'forbidden', 'Only a manager can reopen a pin');
    }
    if (state === 'resolved' && !manager && !isAssignee(task.id, auth.user.id)) {
      return sendError(reply, 403, 'forbidden', 'Only the artist or a manager can resolve a pin');
    }
    db.update(pins).set({ state }).where(eq(pins.id, pin.id)).run();
    return readPins(eq(pins.id, pin.id))[0];
  });

  app.get('/pins/:id/comments', { preHandler: signedIn }, async (request, reply) => {
    return loadPin(request, reply) ? readThread(paramId(request)) : undefined;
  });

  app.post('/pins/:id/comments', { preHandler: signedIn }, async (request, reply) => {
    const found = loadPin(request, reply);
    if (!found) return;
    const parsed = pinCommentRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    db.insert(pinComments)
      .values({
        id: randomUUID(),
        pinId: found.pin.id,
        authorId: request.auth!.user.id,
        body: parsed.data.body,
        createdAt: new Date(),
      })
      .run();
    return reply.code(201).send(readThread(found.pin.id));
  });
};
