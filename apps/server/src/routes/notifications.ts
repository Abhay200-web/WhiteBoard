import { markReadRequestSchema, notificationInboxSchema } from '@whiteboard/core';
import { notifications, projectMembers, projects, tasks, users, type Db } from '@whiteboard/db';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { ALL_ROLES, authenticate, badRequest, requireRole } from '../plugins/auth';
import { isAdmin } from '../projects/access';

/** How many the bell lists; older ones still count as unread until read. */
const LATEST = 50;

/** The signed-in person's bell: their notifications, newest first, and marking them read. */
export const notificationRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];

  app.get('/notifications', { preHandler: signedIn }, async (request) => {
    const auth = request.auth!;
    const me = auth.user.id;
    // Only projects I can still see: after leaving one, its old notifications (with the live
    // task title and project name) stop showing. Admins see every project.
    const mine = and(
      eq(notifications.userId, me),
      isAdmin(auth)
        ? undefined
        : inArray(
            notifications.projectId,
            db
              .select({ id: projectMembers.projectId })
              .from(projectMembers)
              .where(eq(projectMembers.userId, me)),
          ),
    );
    const items = db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        actorName: users.name,
        projectId: notifications.projectId,
        projectName: projects.name,
        taskId: notifications.taskId,
        taskTitle: tasks.title,
        detail: notifications.detail,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
      })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.actorId))
      .innerJoin(projects, eq(projects.id, notifications.projectId))
      .leftJoin(tasks, eq(tasks.id, notifications.taskId))
      .where(mine)
      .orderBy(desc(notifications.createdAt), desc(sql`${notifications}.rowid`))
      .limit(LATEST)
      .all();
    const { unread } = db
      .select({ unread: sql<number>`count(*)` })
      .from(notifications)
      .where(and(mine, isNull(notifications.readAt)))
      .get()!;
    return notificationInboxSchema.parse({
      items: items.map((n) => ({
        ...n,
        createdAt: n.createdAt.getTime(),
        readAt: n.readAt?.getTime() ?? null,
      })),
      unread,
    });
  });

  /** Marks the given notifications read, or all of mine. Others' ids are simply not touched. */
  app.post('/notifications/read', { preHandler: signedIn }, async (request, reply) => {
    const parsed = markReadRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return badRequest(reply);
    const { ids } = parsed.data;
    db.update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, request.auth!.user.id),
          isNull(notifications.readAt),
          ids ? inArray(notifications.id, ids) : undefined,
        ),
      )
      .run();
    return reply.code(204).send();
  });
};
