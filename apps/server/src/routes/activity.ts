import { randomUUID } from 'node:crypto';

import { commentListSchema, commentRequestSchema, taskHistorySchema } from '@whiteboard/core';
import { comments, taskHistory, tasks, users, type Db } from '@whiteboard/db';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { ALL_ROLES, authenticate, badRequest, requireRole, sendError } from '../plugins/auth';
import { canManageProject } from '../projects/access';
import { recordHistory } from '../projects/history';
import { taskAccess } from '../projects/taskAccess';

/**
 * A task's comments and history. Any project member (and admins) may read and comment; only the
 * author edits a comment; the author or a project manager deletes it.
 */
export const activityRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];
  const { allowed, paramId, loadTask, currentProjectMembers } = taskAccess(db);

  const listComments = (taskId: string) =>
    commentListSchema.parse(
      db
        .select({
          id: comments.id,
          taskId: comments.taskId,
          authorId: comments.authorId,
          authorName: users.name,
          body: comments.body,
          mentions: comments.mentions,
          createdAt: comments.createdAt,
          editedAt: comments.editedAt,
        })
        .from(comments)
        .innerJoin(users, eq(users.id, comments.authorId))
        .where(eq(comments.taskId, taskId))
        .orderBy(asc(comments.createdAt), sql`${comments}.rowid`)
        .all()
        .map((c) => ({
          ...c,
          createdAt: c.createdAt.getTime(),
          editedAt: c.editedAt?.getTime() ?? null,
        })),
    );

  /** A comment and its task's project; 404 unless the caller can see that project. */
  function loadComment(request: FastifyRequest, reply: FastifyReply) {
    const comment = db
      .select()
      .from(comments)
      .where(eq(comments.id, paramId(request)))
      .get();
    const task =
      comment &&
      db
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, comment.taskId))
        .get();
    return allowed(request, reply, task?.projectId, 'view', 'Comment not found')
      ? { comment: comment!, projectId: task!.projectId }
      : null;
  }

  app.get('/tasks/:id/comments', { preHandler: signedIn }, async (request, reply) => {
    const task = loadTask(request, reply, 'view');
    return task ? listComments(task.id) : undefined;
  });

  app.post('/tasks/:id/comments', { preHandler: signedIn }, async (request, reply) => {
    const task = loadTask(request, reply, 'view');
    if (!task) return;
    const parsed = commentRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const authorId = request.auth!.user.id;
    db.transaction((tx) => {
      tx.insert(comments)
        .values({
          id: randomUUID(),
          taskId: task.id,
          authorId,
          body: parsed.data.body,
          mentions: currentProjectMembers(task.projectId, parsed.data.mentionIds),
          createdAt: new Date(),
        })
        .run();
      recordHistory(tx, task.id, authorId, { event: 'comment' });
    });
    return reply.code(201).send(listComments(task.id));
  });

  app.patch('/comments/:id', { preHandler: signedIn }, async (request, reply) => {
    const found = loadComment(request, reply);
    if (!found) return;
    if (found.comment.authorId !== request.auth!.user.id) {
      return sendError(reply, 403, 'forbidden', 'Only the author can edit a comment');
    }
    const parsed = commentRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    db.update(comments)
      .set({
        body: parsed.data.body,
        mentions: currentProjectMembers(found.projectId, parsed.data.mentionIds),
        editedAt: new Date(),
      })
      .where(eq(comments.id, found.comment.id))
      .run();
    return listComments(found.comment.taskId);
  });

  app.delete('/comments/:id', { preHandler: signedIn }, async (request, reply) => {
    const found = loadComment(request, reply);
    if (!found) return;
    const auth = request.auth!;
    if (found.comment.authorId !== auth.user.id && !canManageProject(db, auth, found.projectId)) {
      return sendError(reply, 403, 'forbidden', 'Only the author or a manager can delete it');
    }
    db.delete(comments).where(eq(comments.id, found.comment.id)).run();
    return reply.code(204).send();
  });

  /** Oldest first. Rows written in the same millisecond keep the order they were written in. */
  app.get('/tasks/:id/history', { preHandler: signedIn }, async (request, reply) => {
    const task = loadTask(request, reply, 'view');
    if (!task) return;
    const rows = db
      .select({
        id: taskHistory.id,
        event: taskHistory.event,
        data: taskHistory.data,
        at: taskHistory.at,
        actorName: users.name,
      })
      .from(taskHistory)
      .innerJoin(users, eq(users.id, taskHistory.actorId))
      .where(eq(taskHistory.taskId, task.id))
      .orderBy(asc(taskHistory.at), sql`${taskHistory}.rowid`)
      .all();
    return taskHistorySchema.parse(
      rows.map(({ data, at, ...row }) => ({ ...data, ...row, at: at.getTime() })),
    );
  });
};
