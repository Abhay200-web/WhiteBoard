import { randomUUID } from 'node:crypto';

import { commentListSchema, commentRequestSchema, taskHistorySchema } from '@whiteboard/core';
import { comments, taskHistory, tasks, users, type Db, type DbTx } from '@whiteboard/db';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { ALL_ROLES, authenticate, badRequest, requireRole, sendError } from '../plugins/auth';
import type { EventHub } from '../events/hub';
import { canManageProject } from '../projects/access';
import { recordHistory } from '../projects/history';
import { excerpt, notify, taskAudience } from '../projects/notify';
import { taskAccess } from '../projects/taskAccess';

/**
 * A task's comments and history. Any project member (and admins) may read and comment; only the
 * author edits a comment; the author or a project manager deletes it.
 */
export const activityRoutes: FastifyPluginAsync<{ db: Db; hub: EventHub }> = async (
  app,
  { db, hub },
) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];
  const { allowed, paramId, loadTask, currentProjectMembers } = taskAccess(db);

  /** People @-mentioned are told so; the task's other people hear there is a new comment. */
  function tellAbout(
    tx: DbTx,
    c: { taskId: string; projectId: string; authorId: string; body: string },
    mentioned: string[],
    alsoCommented: boolean,
  ) {
    const common = { actorId: c.authorId, projectId: c.projectId, taskId: c.taskId };
    const detail = excerpt(c.body);
    notify(tx, hub, { ...common, to: mentioned, kind: 'mentioned', detail });
    if (!alsoCommented) return;
    const others = taskAudience(tx, c.taskId).filter((id) => !mentioned.includes(id));
    notify(tx, hub, { ...common, to: others, kind: 'commented', detail });
  }

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
    const { body } = parsed.data;
    const mentions = currentProjectMembers(task.projectId, parsed.data.mentionIds);
    db.transaction((tx) => {
      tx.insert(comments)
        .values({
          id: randomUUID(),
          taskId: task.id,
          authorId,
          body,
          mentions,
          createdAt: new Date(),
        })
        .run();
      recordHistory(tx, task.id, authorId, { event: 'comment' });
      tellAbout(tx, { taskId: task.id, projectId: task.projectId, authorId, body }, mentions, true);
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
    const { comment, projectId } = found;
    const { body } = parsed.data;
    const mentions = currentProjectMembers(projectId, parsed.data.mentionIds);
    // Only people newly mentioned by the edit are told; everyone else already heard.
    const newlyMentioned = mentions.filter((id) => !comment.mentions.includes(id));
    db.transaction((tx) => {
      tx.update(comments)
        .set({ body, mentions, editedAt: new Date() })
        .where(eq(comments.id, comment.id))
        .run();
      tellAbout(tx, { ...comment, projectId, body }, newlyMentioned, false);
    });
    return listComments(comment.taskId);
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
