import { randomUUID } from 'node:crypto';

import {
  createTaskStatusRequestSchema,
  reorderTaskStatusesRequestSchema,
  SORT_STEP,
  TASK_STATUS_KIND_LABEL,
  taskStatusListSchema,
  updateTaskStatusRequestSchema,
} from '@whiteboard/core';
import { taskStatuses, tasks, type Db } from '@whiteboard/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { EventHub } from '../events/hub';
import { authenticate, badRequest, requireRole, sendError, ALL_ROLES } from '../plugins/auth';
import { projectViewers } from '../projects/access';
import { taskAccess } from '../projects/taskAccess';

/**
 * A project's task statuses (the kanban columns). Everyone on the project reads them; its
 * managers add, rename, reorder and delete them. Every change answers with the new list and
 * tells open apps on the project to reload their columns.
 */
export const statusRoutes: FastifyPluginAsync<{ db: Db; hub: EventHub }> = async (
  app,
  { db, hub },
) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];
  const { loadProjectId } = taskAccess(db);

  const list = (projectId: string) =>
    taskStatusListSchema.parse(
      db
        .select({
          id: taskStatuses.id,
          name: taskStatuses.name,
          kind: taskStatuses.kind,
          sortKey: taskStatuses.sortKey,
        })
        .from(taskStatuses)
        .where(eq(taskStatuses.projectId, projectId))
        .orderBy(asc(taskStatuses.sortKey))
        .all(),
    );

  /** The new list, after telling every open app that can see the project. */
  function changed(projectId: string) {
    hub.send(projectViewers(db, projectId, hub.connectedUsers()), {
      type: 'statuses.changed',
      projectId,
    });
    return list(projectId);
  }

  const statusIn = (projectId: string, request: FastifyRequest) =>
    db
      .select()
      .from(taskStatuses)
      .where(
        and(
          eq(taskStatuses.id, (request.params as { statusId: string }).statusId),
          eq(taskStatuses.projectId, projectId),
        ),
      )
      .get();

  app.get('/projects/:id/statuses', { preHandler: signedIn }, async (request, reply) => {
    const projectId = loadProjectId(request, reply, 'view');
    if (!projectId) return;
    return list(projectId);
  });

  /** A new status goes at the end. */
  app.post('/projects/:id/statuses', { preHandler: signedIn }, async (request, reply) => {
    const projectId = loadProjectId(request, reply, 'manage');
    if (!projectId) return;
    const parsed = createTaskStatusRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const last =
      db
        .select({ max: sql<number | null>`max(${taskStatuses.sortKey})` })
        .from(taskStatuses)
        .where(eq(taskStatuses.projectId, projectId))
        .get()?.max ?? 0;
    db.insert(taskStatuses)
      .values({ id: randomUUID(), projectId, ...parsed.data, sortKey: last + SORT_STEP })
      .run();
    return reply.code(201).send(changed(projectId));
  });

  app.patch(
    '/projects/:id/statuses/:statusId',
    { preHandler: signedIn },
    async (request, reply) => {
      const projectId = loadProjectId(request, reply, 'manage');
      if (!projectId) return;
      const status = statusIn(projectId, request);
      if (!status) return sendError(reply, 404, 'not_found', 'Status not found');
      const parsed = updateTaskStatusRequestSchema.safeParse(request.body);
      if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
      db.update(taskStatuses)
        .set({ name: parsed.data.name })
        .where(eq(taskStatuses.id, status.id))
        .run();
      return changed(projectId);
    },
  );

  /** The whole order at once: the list must hold every status of the project exactly once. */
  app.put('/projects/:id/statuses/order', { preHandler: signedIn }, async (request, reply) => {
    const projectId = loadProjectId(request, reply, 'manage');
    if (!projectId) return;
    const parsed = reorderTaskStatusesRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const { ids } = parsed.data;
    const current = new Set(list(projectId).map((s) => s.id));
    if (ids.length !== current.size || new Set(ids).size !== ids.length) {
      return badRequest(reply, 'The order must list every status once');
    }
    if (!ids.every((id) => current.has(id))) return badRequest(reply, 'Unknown status');
    db.transaction((tx) => {
      ids.forEach((id, i) =>
        tx
          .update(taskStatuses)
          .set({ sortKey: (i + 1) * SORT_STEP })
          .where(eq(taskStatuses.id, id))
          .run(),
      );
    });
    return changed(projectId);
  });

  /**
   * Only an empty status can go, so no task is left without one, and never the last of its
   * kind, because review and approval move tasks to a status of each kind.
   */
  app.delete(
    '/projects/:id/statuses/:statusId',
    { preHandler: signedIn },
    async (request, reply) => {
      const projectId = loadProjectId(request, reply, 'manage');
      if (!projectId) return;
      const status = statusIn(projectId, request);
      if (!status) return sendError(reply, 404, 'not_found', 'Status not found');
      const { count } = db
        .select({ count: sql<number>`count(*)` })
        .from(tasks)
        .where(eq(tasks.statusId, status.id))
        .get()!;
      if (count > 0) {
        const what = count === 1 ? '1 task' : `${count} tasks`;
        return sendError(reply, 409, 'status_in_use', `Move its ${what} to another status first`);
      }
      const sameKind = list(projectId).filter((s) => s.kind === status.kind).length;
      if (sameKind === 1) {
        const label = TASK_STATUS_KIND_LABEL[status.kind];
        return sendError(
          reply,
          409,
          'last_of_kind',
          `The project needs at least one status that behaves like ${label}`,
        );
      }
      db.delete(taskStatuses).where(eq(taskStatuses.id, status.id)).run();
      return changed(projectId);
    },
  );
};
