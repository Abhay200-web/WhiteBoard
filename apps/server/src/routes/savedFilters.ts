import { randomUUID } from 'node:crypto';

import {
  createSavedFilterRequestSchema,
  savedFilterListSchema,
  savedFilterSchema,
  taskFilterSchema,
  type SavedFilter,
} from '@whiteboard/core';
import { savedFilters, type Db } from '@whiteboard/db';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { ALL_ROLES, authenticate, badRequest, requireRole, sendError } from '../plugins/auth';
import { canViewProject } from '../projects/access';

type FilterRow = typeof savedFilters.$inferSelect;

const toApi = (row: FilterRow): SavedFilter =>
  savedFilterSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    filter: taskFilterSchema.parse(JSON.parse(row.filter)),
    createdAt: row.createdAt.getTime(),
  });

/**
 * Saved task filters: each person keeps their own named views of a project's tasks. Nobody else
 * can list or delete them, and a project the person cannot see answers 404.
 */
export const savedFilterRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];

  app.get('/projects/:id/saved-filters', { preHandler: signedIn }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!canViewProject(db, request.auth!, id)) {
      return sendError(reply, 404, 'not_found', 'Project not found');
    }
    const rows = db
      .select()
      .from(savedFilters)
      .where(and(eq(savedFilters.projectId, id), eq(savedFilters.userId, request.auth!.user.id)))
      .orderBy(asc(savedFilters.createdAt))
      .all();
    return savedFilterListSchema.parse(rows.map(toApi));
  });

  app.post('/projects/:id/saved-filters', { preHandler: signedIn }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!canViewProject(db, request.auth!, id)) {
      return sendError(reply, 404, 'not_found', 'Project not found');
    }
    const parsed = createSavedFilterRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const row: FilterRow = {
      id: randomUUID(),
      userId: request.auth!.user.id,
      projectId: id,
      name: parsed.data.name,
      filter: JSON.stringify(parsed.data.filter),
      createdAt: new Date(),
    };
    db.insert(savedFilters).values(row).run();
    reply.code(201);
    return toApi(row);
  });

  app.delete('/saved-filters/:id', { preHandler: signedIn }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = db
      .delete(savedFilters)
      .where(and(eq(savedFilters.id, id), eq(savedFilters.userId, request.auth!.user.id)))
      .run();
    if (deleted.changes === 0) return sendError(reply, 404, 'not_found', 'Saved view not found');
    return reply.code(204).send();
  });
};
