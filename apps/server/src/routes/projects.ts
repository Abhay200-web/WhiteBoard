import { randomUUID } from 'node:crypto';

import {
  DEFAULT_TASK_STATUSES,
  PROJECT_STATUS_FLOW,
  addProjectMemberRequestSchema,
  attachProjectFileRequestSchema,
  createProjectRequestSchema,
  personListSchema,
  projectDetailSchema,
  projectFileListSchema,
  projectListSchema,
  projectSchema,
  setProjectStatusRequestSchema,
  updateProjectRequestSchema,
  type ProjectMemberRole,
} from '@whiteboard/core';
import {
  files,
  memberships,
  projectFiles,
  projectMembers,
  projects,
  taskAssignees,
  tasks,
  taskStatuses,
  users,
  type Db,
} from '@whiteboard/db';
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { authenticate, badRequest, requireRole, sendError, ALL_ROLES } from '../plugins/auth';
import { canManageProject, canViewProject, isAdmin, projectRole } from '../projects/access';
import { canAccessFile } from './files';

type ProjectRow = typeof projects.$inferSelect;

const STAFF_ROLES = ['owner', 'admin', 'member'] as const;

export const projectRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];

  function summary(row: ProjectRow, userId: string) {
    const { count } = db
      .select({ count: sql<number>`count(*)` })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, row.id))
      .get()!;
    return projectSchema.parse({
      id: row.id,
      name: row.name,
      clientName: row.clientName,
      status: row.status,
      startDate: row.startDate?.getTime() ?? null,
      deadline: row.deadline?.getTime() ?? null,
      budget: row.budget,
      color: row.color,
      createdBy: row.createdBy,
      createdAt: row.createdAt.getTime(),
      memberCount: count,
      myRole: projectRole(db, row.id, userId),
    });
  }

  function members(projectId: string) {
    return db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(and(eq(projectMembers.projectId, projectId), isNull(memberships.removedAt)))
      .orderBy(asc(users.name))
      .all();
  }

  function detail(row: ProjectRow, userId: string) {
    return projectDetailSchema.parse({
      ...summary(row, userId),
      brief: row.brief ?? null,
      instructions: row.instructions ?? null,
      members: members(row.id),
    });
  }

  /** Loads a project the caller may view; replies 404 otherwise (no probing for ids). */
  function loadViewable(request: FastifyRequest, reply: FastifyReply): ProjectRow | null {
    const { id } = request.params as { id: string };
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row || !canViewProject(db, request.auth!, row.id)) {
      void sendError(reply, 404, 'not_found', 'Project not found');
      return null;
    }
    return row;
  }

  /** Like `loadViewable`, but the caller must also be a project manager or admin (else 403). */
  function loadManageable(request: FastifyRequest, reply: FastifyReply): ProjectRow | null {
    const row = loadViewable(request, reply);
    if (!row) return null;
    if (!canManageProject(db, request.auth!, row.id)) {
      void sendError(reply, 403, 'forbidden', 'Only a project manager can do this');
      return null;
    }
    return row;
  }

  // --- projects ---------------------------------------------------------------------------

  app.post(
    '/projects',
    { preHandler: [authenticate(db), requireRole(STAFF_ROLES)] },
    async (request, reply) => {
      const parsed = createProjectRequestSchema.safeParse(request.body);
      if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
      const body = parsed.data;
      const auth = request.auth!;
      const id = randomUUID();
      db.transaction((tx) => {
        tx.insert(projects)
          .values({
            id,
            workspaceId: auth.workspaceId,
            name: body.name,
            clientName: body.clientName ?? null,
            brief: body.brief ?? null,
            instructions: body.instructions ?? null,
            status: 'draft',
            startDate: body.startDate != null ? new Date(body.startDate) : null,
            deadline: body.deadline != null ? new Date(body.deadline) : null,
            budget: body.budget ?? null,
            color: body.color ?? null,
            createdBy: auth.user.id,
            createdAt: new Date(),
          })
          .run();
        // The creator leads the project.
        tx.insert(projectMembers)
          .values({ projectId: id, userId: auth.user.id, role: 'manager' })
          .run();
        tx.insert(taskStatuses)
          .values(
            DEFAULT_TASK_STATUSES.map((s, i) => ({
              id: randomUUID(),
              projectId: id,
              name: s.name,
              kind: s.kind,
              sortKey: (i + 1) * 1000,
            })),
          )
          .run();
      });
      const row = db.select().from(projects).where(eq(projects.id, id)).get()!;
      return reply.code(201).send(detail(row, auth.user.id));
    },
  );

  app.get('/projects', { preHandler: signedIn }, async (request) => {
    const auth = request.auth!;
    const rows = isAdmin(auth)
      ? db.select().from(projects).all()
      : db
          .select({ project: projects })
          .from(projects)
          .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
          .where(eq(projectMembers.userId, auth.user.id))
          .all()
          .map((r) => r.project);
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return projectListSchema.parse(rows.map((row) => summary(row, auth.user.id)));
  });

  app.get('/projects/:id', { preHandler: signedIn }, async (request, reply) => {
    const row = loadViewable(request, reply);
    return row ? detail(row, request.auth!.user.id) : undefined;
  });

  app.patch('/projects/:id', { preHandler: signedIn }, async (request, reply) => {
    const row = loadManageable(request, reply);
    if (!row) return;
    const parsed = updateProjectRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const b = parsed.data;
    const startDate = b.startDate !== undefined ? b.startDate : (row.startDate?.getTime() ?? null);
    const deadline = b.deadline !== undefined ? b.deadline : (row.deadline?.getTime() ?? null);
    if (startDate != null && deadline != null && deadline < startDate) {
      return badRequest(reply, 'The deadline cannot be before the start date');
    }
    db.update(projects)
      .set({
        ...(b.name !== undefined && { name: b.name }),
        ...(b.clientName !== undefined && { clientName: b.clientName }),
        ...(b.brief !== undefined && { brief: b.brief }),
        ...(b.instructions !== undefined && { instructions: b.instructions }),
        ...(b.startDate !== undefined && { startDate: b.startDate ? new Date(b.startDate) : null }),
        ...(b.deadline !== undefined && { deadline: b.deadline ? new Date(b.deadline) : null }),
        ...(b.budget !== undefined && { budget: b.budget }),
        ...(b.color !== undefined && { color: b.color }),
      })
      .where(eq(projects.id, row.id))
      .run();
    const updated = db.select().from(projects).where(eq(projects.id, row.id)).get()!;
    return detail(updated, request.auth!.user.id);
  });

  app.post('/projects/:id/status', { preHandler: signedIn }, async (request, reply) => {
    const row = loadManageable(request, reply);
    if (!row) return;
    const parsed = setProjectStatusRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, 'Unknown status');
    const next = parsed.data.status;
    if (!PROJECT_STATUS_FLOW[row.status].includes(next)) {
      return sendError(
        reply,
        409,
        'invalid_status_change',
        `A ${row.status.replace('_', ' ')} project cannot move to ${next.replace('_', ' ')}`,
      );
    }
    db.update(projects)
      .set({ status: next, archivedAt: next === 'archived' ? new Date() : null })
      .where(eq(projects.id, row.id))
      .run();
    const updated = db.select().from(projects).where(eq(projects.id, row.id)).get()!;
    return detail(updated, request.auth!.user.id);
  });

  // --- people & members --------------------------------------------------------------------

  /** Staff and freelancers who can be added to a project. Freelancers never see this list. */
  app.get(
    '/people',
    { preHandler: [authenticate(db), requireRole(STAFF_ROLES)] },
    async (request) => {
      const now = new Date();
      const rows = db
        .select({ id: users.id, name: users.name, email: users.email, role: memberships.role })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.workspaceId, request.auth!.workspaceId),
            isNull(memberships.removedAt),
            or(isNull(memberships.expiresAt), gt(memberships.expiresAt, now)),
          ),
        )
        .orderBy(asc(users.name))
        .all();
      return personListSchema.parse(rows);
    },
  );

  app.post('/projects/:id/members', { preHandler: signedIn }, async (request, reply) => {
    const row = loadManageable(request, reply);
    if (!row) return;
    const parsed = addProjectMemberRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply);
    const { userId, role } = parsed.data;

    const target = db
      .select({ role: memberships.role, expiresAt: memberships.expiresAt })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.workspaceId, request.auth!.workspaceId),
          isNull(memberships.removedAt),
        ),
      )
      .get();
    if (!target || (target.expiresAt && target.expiresAt.getTime() <= Date.now())) {
      return sendError(reply, 404, 'not_found', 'Person not found');
    }
    // Freelancers work on tasks; they do not run projects.
    if (target.role === 'guest' && role === 'manager') {
      return badRequest(reply, 'Freelancers can only be added as artists');
    }
    if (projectRole(db, row.id, userId)) {
      return sendError(reply, 409, 'already_member', 'They are already on this project');
    }
    db.insert(projectMembers).values({ projectId: row.id, userId, role }).run();
    return reply.code(201).send(detail(row, request.auth!.user.id));
  });

  app.delete('/projects/:id/members/:userId', { preHandler: signedIn }, async (request, reply) => {
    const row = loadManageable(request, reply);
    if (!row) return;
    const { userId } = request.params as { userId: string };
    const role: ProjectMemberRole | null = projectRole(db, row.id, userId);
    if (!role) return sendError(reply, 404, 'not_found', 'They are not on this project');
    if (role === 'manager') {
      const managers = db
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, row.id), eq(projectMembers.role, 'manager')))
        .all();
      if (managers.length <= 1) {
        return badRequest(reply, 'A project needs at least one manager');
      }
    }
    db.transaction((tx) => {
      tx.delete(projectMembers)
        .where(and(eq(projectMembers.projectId, row.id), eq(projectMembers.userId, userId)))
        .run();
      // They leave the project's tasks too, so no task stays assigned to a non-member.
      // (Part 4.8 adds choosing who takes those tasks over.)
      const projectTasks = tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.projectId, row.id));
      tx.delete(taskAssignees)
        .where(and(eq(taskAssignees.userId, userId), inArray(taskAssignees.taskId, projectTasks)))
        .run();
    });
    return reply.code(204).send();
  });

  // --- project files -----------------------------------------------------------------------

  function listFiles(projectId: string) {
    return db
      .select({
        fileId: projectFiles.fileId,
        kind: projectFiles.kind,
        addedBy: projectFiles.addedBy,
        addedAt: projectFiles.addedAt,
        name: files.name,
        mimeType: files.mimeType,
        size: files.size,
        thumbnailPath: files.thumbnailPath,
      })
      .from(projectFiles)
      .innerJoin(files, eq(files.id, projectFiles.fileId))
      .where(eq(projectFiles.projectId, projectId))
      .orderBy(asc(projectFiles.addedAt))
      .all()
      .map(({ thumbnailPath, addedAt, ...rest }) => ({
        ...rest,
        addedAt: addedAt.getTime(),
        hasThumbnail: thumbnailPath !== null,
      }));
  }

  app.get('/projects/:id/files', { preHandler: signedIn }, async (request, reply) => {
    const row = loadViewable(request, reply);
    return row ? projectFileListSchema.parse(listFiles(row.id)) : undefined;
  });

  /** Attaches an already-uploaded file (`POST /files`) to the project. Managers and admins only. */
  app.post('/projects/:id/files', { preHandler: signedIn }, async (request, reply) => {
    const row = loadManageable(request, reply);
    if (!row) return;
    const parsed = attachProjectFileRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply);
    const file = db.select().from(files).where(eq(files.id, parsed.data.fileId)).get();
    // You can only attach files you can already read (your own uploads, or files of your projects).
    if (!file || !canAccessFile(db, request.auth!, file)) {
      return sendError(reply, 404, 'not_found', 'File not found');
    }
    db.insert(projectFiles)
      .values({
        projectId: row.id,
        fileId: file.id,
        kind: parsed.data.kind,
        addedBy: request.auth!.user.id,
        addedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [projectFiles.projectId, projectFiles.fileId],
        set: { kind: parsed.data.kind },
      })
      .run();
    return reply.code(201).send(projectFileListSchema.parse(listFiles(row.id)));
  });

  /** Removes the file from the project. The file itself stays on the Host. */
  app.delete('/projects/:id/files/:fileId', { preHandler: signedIn }, async (request, reply) => {
    const row = loadManageable(request, reply);
    if (!row) return;
    const { fileId } = request.params as { fileId: string };
    const removed = db
      .delete(projectFiles)
      .where(and(eq(projectFiles.projectId, row.id), eq(projectFiles.fileId, fileId)))
      .returning({ fileId: projectFiles.fileId })
      .all();
    if (removed.length === 0)
      return sendError(reply, 404, 'not_found', 'File is not on this project');
    return reply.code(204).send();
  });
};
