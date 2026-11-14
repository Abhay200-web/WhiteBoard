import {
  memberships,
  projectMembers,
  projects,
  subtasks,
  taskAssignees,
  tasks,
  type Db,
} from '@whiteboard/db';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { sendError } from '../plugins/auth';
import { canManageProject, canViewProject } from './access';

export type Need = 'view' | 'manage';

/**
 * Loaders and checks shared by the task, subtask and comment routes. Every route finds its
 * project from the stored row (never from the request) and goes through `allowed`.
 */
export function taskAccess(db: Db) {
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
    return allowed(request, reply, task?.projectId, need, 'Subtask not found')
      ? { ...subtask!, projectId: task!.projectId }
      : null;
  }

  const isAssignee = (taskId: string, userId: string) =>
    db
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)))
      .get() !== undefined;

  /** Which of `userIds` are current members of the project (not removed, access not expired). */
  function currentProjectMembers(projectId: string, userIds: string[]): string[] {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];
    return db
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
      .all()
      .map((r) => r.userId);
  }

  const allProjectMembers = (projectId: string, userIds: string[]) =>
    currentProjectMembers(projectId, userIds).length === new Set(userIds).size;

  return {
    allowed,
    paramId,
    loadProjectId,
    loadTask,
    loadSubtask,
    isAssignee,
    currentProjectMembers,
    allProjectMembers,
  };
}
