import { randomUUID } from 'node:crypto';

import {
  attachedFileListSchema,
  attachTaskFileRequestSchema,
  canMoveTask,
  createSubtaskRequestSchema,
  createTaskRequestSchema,
  myTaskListSchema,
  setAssigneesRequestSchema,
  SORT_STEP,
  subtaskListSchema,
  taskListSchema,
  taskSchema,
  taskStatusListSchema,
  updateSubtaskRequestSchema,
  updateTaskRequestSchema,
} from '@whiteboard/core';
import {
  files,
  memberships,
  projectMembers,
  projects,
  subtasks,
  taskAssignees,
  taskFiles,
  taskStatuses,
  tasks,
  users,
  type Db,
} from '@whiteboard/db';
import { and, asc, eq, gt, inArray, isNull, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { authenticate, badRequest, requireRole, sendError, ALL_ROLES } from '../plugins/auth';
import { canManageProject, canViewProject, isAdmin } from '../projects/access';
import { canAccessFile } from './files';

type TaskRow = typeof tasks.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Need = 'view' | 'manage';

export const taskRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];

  // --- access ------------------------------------------------------------------------------

  /** 404 unless the caller can see the project (no probing for ids); 403 if they must manage it. */
  function allowed(
    request: FastifyRequest,
    reply: FastifyReply,
    projectId: string | undefined,
    need: Need,
    notFound: string,
  ): projectId is string {
    const auth = request.auth!;
    if (!projectId || !canViewProject(db, auth, projectId)) {
      void sendError(reply, 404, 'not_found', notFound);
      return false;
    }
    if (need === 'manage' && !canManageProject(db, auth, projectId)) {
      void sendError(reply, 403, 'forbidden', 'Only a project manager can do this');
      return false;
    }
    return true;
  }

  const paramId = (request: FastifyRequest) => (request.params as { id: string }).id;

  function loadProjectId(request: FastifyRequest, reply: FastifyReply, need: Need) {
    const id = db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, paramId(request)))
      .get()?.id;
    return allowed(request, reply, id, need, 'Project not found') ? id : null;
  }

  function loadTask(
    request: FastifyRequest,
    reply: FastifyReply,
    need: Need,
    id = paramId(request),
  ) {
    const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
    return allowed(request, reply, task?.projectId, need, 'Task not found') ? task! : null;
  }

  function loadSubtask(request: FastifyRequest, reply: FastifyReply, need: Need) {
    const subtask = db
      .select()
      .from(subtasks)
      .where(eq(subtasks.id, paramId(request)))
      .get();
    const task =
      subtask &&
      db
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(eq(tasks.id, subtask.taskId))
        .get();
    return allowed(request, reply, task?.projectId, need, 'Subtask not found') ? subtask! : null;
  }

  const isAssignee = (taskId: string, userId: string) =>
    db
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)))
      .get() !== undefined;

  /** True when every id is a current member of the project (not removed, access not expired). */
  function allProjectMembers(projectId: string, userIds: string[]): boolean {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return true;
    const found = db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .innerJoin(memberships, eq(memberships.userId, projectMembers.userId))
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          inArray(projectMembers.userId, unique),
          isNull(memberships.removedAt),
          or(isNull(memberships.expiresAt), gt(memberships.expiresAt, new Date())),
        ),
      )
      .all();
    return found.length === unique.length;
  }

  const NOT_MEMBERS = 'Tasks can only be assigned to people on this project';
  const refuseMove = (reply: FastifyReply, statusName: string) =>
    sendError(reply, 403, 'forbidden', `You cannot move this task to ${statusName}`);

  // --- reading -----------------------------------------------------------------------------

  const statusOf = (projectId: string, statusId: string) =>
    db
      .select()
      .from(taskStatuses)
      .where(and(eq(taskStatuses.id, statusId), eq(taskStatuses.projectId, projectId)))
      .get();

  /** New cards and checklist items go to the end of their list. */
  const nextTaskKey = (statusId: string) =>
    SORT_STEP +
    (db
      .select({ max: sql<number | null>`max(${tasks.sortKey})` })
      .from(tasks)
      .where(eq(tasks.statusId, statusId))
      .get()?.max ?? 0);
  const nextSubtaskKey = (taskId: string) =>
    SORT_STEP +
    (db
      .select({ max: sql<number | null>`max(${subtasks.sortKey})` })
      .from(subtasks)
      .where(eq(subtasks.taskId, taskId))
      .get()?.max ?? 0);

  /** Task rows to API objects, with three batched queries however many tasks there are. */
  function serialize(rows: TaskRow[]) {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return [];
    const people = db
      .select({ taskId: taskAssignees.taskId, userId: users.id, name: users.name })
      .from(taskAssignees)
      .innerJoin(users, eq(users.id, taskAssignees.userId))
      .where(inArray(taskAssignees.taskId, ids))
      .orderBy(asc(users.name))
      .all();
    const checklist = db
      .select({
        taskId: subtasks.taskId,
        total: sql<number>`count(*)`,
        done: sql<number>`sum(${subtasks.done})`,
      })
      .from(subtasks)
      .where(inArray(subtasks.taskId, ids))
      .groupBy(subtasks.taskId)
      .all();
    const attached = db
      .select({ taskId: taskFiles.taskId, count: sql<number>`count(*)` })
      .from(taskFiles)
      .where(inArray(taskFiles.taskId, ids))
      .groupBy(taskFiles.taskId)
      .all();
    // Group once so each task is a lookup, not a scan of every row.
    const assigneesOf = new Map<string, { userId: string; name: string }[]>();
    for (const { taskId, userId, name } of people) {
      const list = assigneesOf.get(taskId) ?? [];
      list.push({ userId, name });
      assigneesOf.set(taskId, list);
    }
    const countsOf = new Map(checklist.map((c) => [c.taskId, c]));
    const filesOf = new Map(attached.map((a) => [a.taskId, a.count]));
    return rows.map((row) => {
      const counts = countsOf.get(row.id);
      return taskSchema.parse({
        id: row.id,
        projectId: row.projectId,
        statusId: row.statusId,
        title: row.title,
        description: row.description ?? null,
        priority: row.priority,
        startAt: row.startAt?.getTime() ?? null,
        dueAt: row.dueAt?.getTime() ?? null,
        sortKey: row.sortKey,
        createdBy: row.createdBy,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
        assignees: assigneesOf.get(row.id) ?? [],
        subtaskCounts: { done: Number(counts?.done ?? 0), total: counts?.total ?? 0 },
        fileCount: filesOf.get(row.id) ?? 0,
      });
    });
  }

  const reload = (id: string) =>
    serialize([db.select().from(tasks).where(eq(tasks.id, id)).get()!])[0];

  function writeAssignees(tx: Tx, taskId: string, userIds: string[]) {
    tx.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId)).run();
    const unique = [...new Set(userIds)];
    if (unique.length > 0) {
      tx.insert(taskAssignees)
        .values(unique.map((userId) => ({ taskId, userId })))
        .run();
    }
  }

  // --- statuses and tasks ------------------------------------------------------------------

  app.get('/projects/:id/statuses', { preHandler: signedIn }, async (request, reply) => {
    const projectId = loadProjectId(request, reply, 'view');
    if (!projectId) return;
    const rows = db
      .select({
        id: taskStatuses.id,
        name: taskStatuses.name,
        kind: taskStatuses.kind,
        sortKey: taskStatuses.sortKey,
      })
      .from(taskStatuses)
      .where(eq(taskStatuses.projectId, projectId))
      .orderBy(asc(taskStatuses.sortKey))
      .all();
    return taskStatusListSchema.parse(rows);
  });

  /** All tasks of a project, column by column, each column in its own order. */
  app.get('/projects/:id/tasks', { preHandler: signedIn }, async (request, reply) => {
    const projectId = loadProjectId(request, reply, 'view');
    if (!projectId) return;
    const rows = db
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(taskStatuses, eq(taskStatuses.id, tasks.statusId))
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(taskStatuses.sortKey), asc(tasks.sortKey))
      .all();
    return taskListSchema.parse(serialize(rows.map((r) => r.task)));
  });

  // --- across projects ("My tasks", review queue) ------------------------------------------

  /** Tasks matching `where` in projects that are not archived, with project and status names. */
  function listAcrossProjects(where: SQL | undefined) {
    const rows = db
      .select({ task: tasks, projectName: projects.name, statusName: taskStatuses.name })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .innerJoin(taskStatuses, eq(taskStatuses.id, tasks.statusId))
      .where(and(ne(projects.status, 'archived'), where))
      .orderBy(asc(tasks.createdAt))
      .all();
    return myTaskListSchema.parse(
      serialize(rows.map((r) => r.task)).map((task, i) => ({
        ...task,
        projectName: rows[i]!.projectName,
        statusName: rows[i]!.statusName,
      })),
    );
  }

  /** My open work everywhere: assigned to me, not approved or done. The web groups it by date. */
  app.get('/me/tasks', { preHandler: signedIn }, async (request) => {
    const mine = db
      .select({ id: taskAssignees.taskId })
      .from(taskAssignees)
      .where(eq(taskAssignees.userId, request.auth!.user.id));
    return listAcrossProjects(
      and(inArray(tasks.id, mine), notInArray(taskStatuses.kind, ['approved', 'done'])),
    );
  });

  /** Tasks waiting for review in the projects I manage (admins: all). Artists get an empty list. */
  app.get('/me/review-queue', { preHandler: signedIn }, async (request) => {
    const auth = request.auth!;
    const managed = db
      .select({ id: projectMembers.projectId })
      .from(projectMembers)
      .where(and(eq(projectMembers.userId, auth.user.id), eq(projectMembers.role, 'manager')));
    return listAcrossProjects(
      and(
        eq(taskStatuses.kind, 'review'),
        isAdmin(auth) ? undefined : inArray(tasks.projectId, managed),
      ),
    );
  });

  app.post('/projects/:id/tasks', { preHandler: signedIn }, async (request, reply) => {
    const projectId = loadProjectId(request, reply, 'manage');
    if (!projectId) return;
    const parsed = createTaskRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const b = parsed.data;
    const status = b.statusId
      ? statusOf(projectId, b.statusId)
      : db
          .select()
          .from(taskStatuses)
          .where(and(eq(taskStatuses.projectId, projectId), eq(taskStatuses.kind, 'todo')))
          .orderBy(asc(taskStatuses.sortKey))
          .get();
    if (!status) return badRequest(reply, 'Unknown status');
    if (!canMoveTask('todo', status.kind, true)) return refuseMove(reply, status.name);
    if (!allProjectMembers(projectId, b.assigneeIds)) return badRequest(reply, NOT_MEMBERS);

    const id = randomUUID();
    const now = new Date();
    db.transaction((tx) => {
      tx.insert(tasks)
        .values({
          id,
          projectId,
          statusId: status.id,
          title: b.title,
          description: b.description ?? null,
          priority: b.priority,
          startAt: b.startAt != null ? new Date(b.startAt) : null,
          dueAt: b.dueAt != null ? new Date(b.dueAt) : null,
          sortKey: nextTaskKey(status.id),
          createdBy: request.auth!.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      writeAssignees(tx, id, b.assigneeIds);
    });
    return reply.code(201).send(reload(id));
  });

  app.get('/tasks/:id', { preHandler: signedIn }, async (request, reply) => {
    const task = loadTask(request, reply, 'view');
    return task ? serialize([task])[0] : undefined;
  });

  /** Managers edit anything; an assignee may only move their task (`statusId`, `sortKey`). */
  app.patch('/tasks/:id', { preHandler: signedIn }, async (request, reply) => {
    const task = loadTask(request, reply, 'view');
    if (!task) return;
    const parsed = updateTaskRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const b = parsed.data;
    const auth = request.auth!;
    const isManager = canManageProject(db, auth, task.projectId);
    const onlyMoving = Object.keys(b).every((key) => key === 'statusId' || key === 'sortKey');
    if (!isManager && !(onlyMoving && isAssignee(task.id, auth.user.id))) {
      return sendError(reply, 403, 'forbidden', 'Only a project manager can do this');
    }

    const startAt = b.startAt !== undefined ? b.startAt : (task.startAt?.getTime() ?? null);
    const dueAt = b.dueAt !== undefined ? b.dueAt : (task.dueAt?.getTime() ?? null);
    if (startAt != null && dueAt != null && dueAt < startAt) {
      return badRequest(reply, 'The due date cannot be before the start date');
    }

    let sortKey = b.sortKey;
    if (b.statusId !== undefined && b.statusId !== task.statusId) {
      const to = statusOf(task.projectId, b.statusId);
      if (!to) return badRequest(reply, 'Unknown status');
      const from = statusOf(task.projectId, task.statusId)!;
      if (!canMoveTask(from.kind, to.kind, isManager)) return refuseMove(reply, to.name);
      sortKey ??= nextTaskKey(to.id);
    }

    db.transaction((tx) => {
      tx.update(tasks)
        .set({
          ...(b.title !== undefined && { title: b.title }),
          ...(b.description !== undefined && { description: b.description }),
          ...(b.priority !== undefined && { priority: b.priority }),
          ...(b.startAt !== undefined && {
            startAt: b.startAt != null ? new Date(b.startAt) : null,
          }),
          ...(b.dueAt !== undefined && { dueAt: b.dueAt != null ? new Date(b.dueAt) : null }),
          ...(b.statusId !== undefined && { statusId: b.statusId }),
          ...(sortKey !== undefined && { sortKey }),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id))
        .run();
      if (b.sortKey !== undefined)
        spreadIfTied(tx, b.statusId ?? task.statusId, task.id, b.sortKey);
    });
    return reload(task.id);
  });

  /**
   * A dropped card can get the same sort key as a neighbour once no gap is left between them.
   * Then renumber the column with fresh gaps, keeping the moved card just after the one it tied
   * with (the web puts a card before its target by taking the floor of the midpoint).
   */
  function spreadIfTied(tx: Tx, statusId: string, movedId: string, sortKey: number) {
    const column = tx
      .select({ id: tasks.id, sortKey: tasks.sortKey })
      .from(tasks)
      .where(eq(tasks.statusId, statusId))
      .all();
    if (!column.some((t) => t.id !== movedId && t.sortKey === sortKey)) return;
    column.sort(
      (a, b) => a.sortKey - b.sortKey || Number(a.id === movedId) - Number(b.id === movedId),
    );
    column.forEach((t, i) => {
      tx.update(tasks)
        .set({ sortKey: (i + 1) * SORT_STEP })
        .where(eq(tasks.id, t.id))
        .run();
    });
  }

  /** Deletes the task with its assignees, subtasks and attachments (the files stay on the Host). */
  app.delete('/tasks/:id', { preHandler: signedIn }, async (request, reply) => {
    const task = loadTask(request, reply, 'manage');
    if (!task) return;
    db.delete(tasks).where(eq(tasks.id, task.id)).run();
    return reply.code(204).send();
  });

  app.put('/tasks/:id/assignees', { preHandler: signedIn }, async (request, reply) => {
    const task = loadTask(request, reply, 'manage');
    if (!task) return;
    const parsed = setAssigneesRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply);
    if (!allProjectMembers(task.projectId, parsed.data.userIds)) {
      return badRequest(reply, NOT_MEMBERS);
    }
    db.transaction((tx) => {
      writeAssignees(tx, task.id, parsed.data.userIds);
      tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id)).run();
    });
    return reload(task.id);
  });

  // --- subtasks ----------------------------------------------------------------------------

  const listSubtasks = (taskId: string) =>
    subtaskListSchema.parse(
      db
        .select()
        .from(subtasks)
        .where(eq(subtasks.taskId, taskId))
        .orderBy(asc(subtasks.sortKey))
        .all(),
    );

  app.get('/tasks/:id/subtasks', { preHandler: signedIn }, async (request, reply) => {
    const task = loadTask(request, reply, 'view');
    return task ? listSubtasks(task.id) : undefined;
  });

  app.post('/tasks/:id/subtasks', { preHandler: signedIn }, async (request, reply) => {
    const task = loadTask(request, reply, 'manage');
    if (!task) return;
    const parsed = createSubtaskRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    db.insert(subtasks)
      .values({
        id: randomUUID(),
        taskId: task.id,
        title: parsed.data.title,
        sortKey: nextSubtaskKey(task.id),
      })
      .run();
    return reply.code(201).send(listSubtasks(task.id));
  });

  /** Managers rename, reorder or tick; an assignee may only tick (`done`). */
  app.patch('/subtasks/:id', { preHandler: signedIn }, async (request, reply) => {
    const subtask = loadSubtask(request, reply, 'view');
    if (!subtask) return;
    const parsed = updateSubtaskRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const b = parsed.data;
    const auth = request.auth!;
    const task = db.select().from(tasks).where(eq(tasks.id, subtask.taskId)).get()!;
    const onlyTicking = Object.keys(b).every((key) => key === 'done');
    if (
      !canManageProject(db, auth, task.projectId) &&
      !(onlyTicking && isAssignee(task.id, auth.user.id))
    ) {
      return sendError(reply, 403, 'forbidden', 'Only a project manager can do this');
    }
    db.update(subtasks).set(b).where(eq(subtasks.id, subtask.id)).run();
    return listSubtasks(task.id);
  });

  app.delete('/subtasks/:id', { preHandler: signedIn }, async (request, reply) => {
    const subtask = loadSubtask(request, reply, 'manage');
    if (!subtask) return;
    db.delete(subtasks).where(eq(subtasks.id, subtask.id)).run();
    return reply.code(204).send();
  });

  // --- task files --------------------------------------------------------------------------

  function listTaskFiles(taskId: string) {
    const rows = db
      .select({
        fileId: taskFiles.fileId,
        addedBy: taskFiles.addedBy,
        addedAt: taskFiles.addedAt,
        name: files.name,
        mimeType: files.mimeType,
        size: files.size,
        thumbnailPath: files.thumbnailPath,
      })
      .from(taskFiles)
      .innerJoin(files, eq(files.id, taskFiles.fileId))
      .where(eq(taskFiles.taskId, taskId))
      .orderBy(asc(taskFiles.addedAt))
      .all();
    return attachedFileListSchema.parse(
      rows.map(({ thumbnailPath, addedAt, ...rest }) => ({
        ...rest,
        addedAt: addedAt.getTime(),
        hasThumbnail: thumbnailPath !== null,
      })),
    );
  }

  app.get('/tasks/:id/files', { preHandler: signedIn }, async (request, reply) => {
    const task = loadTask(request, reply, 'view');
    return task ? listTaskFiles(task.id) : undefined;
  });

  /** Attaches an already-uploaded file (`POST /files`) the caller can read. Managers and admins. */
  app.post('/tasks/:id/files', { preHandler: signedIn }, async (request, reply) => {
    const task = loadTask(request, reply, 'manage');
    if (!task) return;
    const parsed = attachTaskFileRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply);
    const file = db.select().from(files).where(eq(files.id, parsed.data.fileId)).get();
    if (!file || !canAccessFile(db, request.auth!, file)) {
      return sendError(reply, 404, 'not_found', 'File not found');
    }
    db.insert(taskFiles)
      .values({
        taskId: task.id,
        fileId: file.id,
        addedBy: request.auth!.user.id,
        addedAt: new Date(),
      })
      .onConflictDoNothing()
      .run();
    return reply.code(201).send(listTaskFiles(task.id));
  });

  /** Removes the attachment. The file itself stays on the Host. */
  app.delete('/tasks/:id/files/:fileId', { preHandler: signedIn }, async (request, reply) => {
    const task = loadTask(request, reply, 'manage');
    if (!task) return;
    const { fileId } = request.params as { fileId: string };
    const removed = db
      .delete(taskFiles)
      .where(and(eq(taskFiles.taskId, task.id), eq(taskFiles.fileId, fileId)))
      .returning({ fileId: taskFiles.fileId })
      .all();
    if (removed.length === 0) return sendError(reply, 404, 'not_found', 'File is not on this task');
    return reply.code(204).send();
  });
};
