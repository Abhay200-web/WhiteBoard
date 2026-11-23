import { randomUUID } from 'node:crypto';

import {
  compareQuerySchema,
  createDeliverableRequestSchema,
  deliverableListSchema,
  reviewRequestSchema,
  submitVersionRequestSchema,
  versionCompareSchema,
  type Deliverable,
  type DeliverableState,
  type ReviewDecision,
  type TaskStatusKind,
} from '@whiteboard/core';
import {
  deliverables,
  deliverableVersions,
  files,
  reviews,
  taskAssignees,
  taskFiles,
  taskStatuses,
  tasks,
  users,
  type Db,
} from '@whiteboard/db';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';

import type { EventHub } from '../events/hub';
import { authenticate, badRequest, requireRole, sendError, ALL_ROLES } from '../plugins/auth';
import { recordHistory } from '../projects/history';
import { notify, announceTaskChange, taskAudience } from '../projects/notify';
import { nextTaskKey, taskAccess } from '../projects/taskAccess';
import { canAccessFile } from './files';

/** Task statuses an artist can send work from. Not from In review, Approved or Done. */
const SUBMITTABLE: readonly TaskStatusKind[] = ['todo', 'doing', 'changes'];

/** What a manager's decision does: the version's new state and the status its task moves to. */
const DECISIONS: Record<ReviewDecision, { state: DeliverableState; status: TaskStatusKind }> = {
  approve: { state: 'approved', status: 'approved' },
  changes: { state: 'changes', status: 'changes' },
};

export const deliverableRoutes: FastifyPluginAsync<{ db: Db; hub: EventHub }> = async (
  app,
  { db, hub },
) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];
  const { loadTask, isAssignee, paramId } = taskAccess(db);
  const changed = (projectId: string, taskId: string) =>
    announceTaskChange(db, hub, projectId, taskId);
  const notAssignee = (reply: FastifyReply) =>
    sendError(reply, 403, 'forbidden', 'Only the assignee can send work for review');

  /** Deliverables matching `where`, each with its versions. Two queries however many there are. */
  function readDeliverables(where: SQL | undefined): Deliverable[] {
    const list = db
      .select()
      .from(deliverables)
      .where(where)
      .orderBy(asc(deliverables.createdAt))
      .all();
    if (list.length === 0) return [];
    const reviewer = alias(users, 'reviewer');
    const versions = db
      .select({
        deliverableId: deliverableVersions.deliverableId,
        id: deliverableVersions.id,
        number: deliverableVersions.number,
        fileId: deliverableVersions.fileId,
        name: files.name,
        mimeType: files.mimeType,
        size: files.size,
        note: deliverableVersions.note,
        state: deliverableVersions.state,
        submittedBy: users.name,
        submittedAt: deliverableVersions.submittedAt,
        reviewDecision: reviews.decision,
        reviewerName: reviewer.name,
        reviewSummary: reviews.summary,
        reviewedAt: reviews.createdAt,
      })
      .from(deliverableVersions)
      .innerJoin(files, eq(files.id, deliverableVersions.fileId))
      .innerJoin(users, eq(users.id, deliverableVersions.submittedBy))
      .leftJoin(reviews, eq(reviews.versionId, deliverableVersions.id))
      .leftJoin(reviewer, eq(reviewer.id, reviews.reviewerId))
      .where(
        inArray(
          deliverableVersions.deliverableId,
          list.map((d) => d.id),
        ),
      )
      .orderBy(asc(deliverableVersions.number))
      .all();
    return deliverableListSchema.parse(
      list.map((d) => ({
        id: d.id,
        name: d.name,
        versions: versions
          .filter((v) => v.deliverableId === d.id)
          .map((v) => ({
            ...v,
            submittedAt: v.submittedAt.getTime(),
            review:
              v.reviewDecision && v.reviewerName && v.reviewedAt
                ? {
                    decision: v.reviewDecision,
                    reviewerName: v.reviewerName,
                    summary: v.reviewSummary,
                    at: v.reviewedAt.getTime(),
                  }
                : null,
          })),
      })),
    );
  }

  app.get('/tasks/:id/deliverables', { preHandler: signedIn }, async (request, reply) => {
    const task = loadTask(request, reply, 'view');
    return task ? readDeliverables(eq(deliverables.taskId, task.id)) : undefined;
  });

  /** Starts a deliverable (e.g. "Poster") on a task. Only the assignee. */
  app.post('/tasks/:id/deliverables', { preHandler: signedIn }, async (request, reply) => {
    const task = loadTask(request, reply, 'view');
    if (!task) return;
    if (!isAssignee(task.id, request.auth!.user.id)) return notAssignee(reply);
    const parsed = createDeliverableRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const id = randomUUID();
    db.insert(deliverables)
      .values({
        id,
        taskId: task.id,
        name: parsed.data.name,
        createdBy: request.auth!.user.id,
        createdAt: new Date(),
      })
      .run();
    return reply.code(201).send(readDeliverables(eq(deliverables.id, id))[0]);
  });

  /**
   * Sends a new version of a deliverable for review: stores the file as the next version, attaches
   * it to the task (so the manager can open it), moves the task to In review and tells the people
   * on the task. Only the assignee, and only from To do, In progress or Changes requested.
   */
  app.post('/deliverables/:id/versions', { preHandler: signedIn }, async (request, reply) => {
    const deliverable = db
      .select()
      .from(deliverables)
      .where(eq(deliverables.id, paramId(request)))
      .get();
    if (!deliverable) return sendError(reply, 404, 'not_found', 'Deliverable not found');
    const task = loadTask(request, reply, 'view', deliverable.taskId);
    if (!task) return;
    const auth = request.auth!;
    if (!isAssignee(task.id, auth.user.id)) return notAssignee(reply);

    const current = db.select().from(taskStatuses).where(eq(taskStatuses.id, task.statusId)).get()!;
    if (!SUBMITTABLE.includes(current.kind)) {
      return sendError(
        reply,
        409,
        'not_submittable',
        `A task in ${current.name} cannot be sent for review`,
      );
    }
    const parsed = submitVersionRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const file = db.select().from(files).where(eq(files.id, parsed.data.fileId)).get();
    if (!file || !canAccessFile(db, auth, file)) {
      return sendError(reply, 404, 'not_found', 'File not found');
    }

    const review = db
      .select()
      .from(taskStatuses)
      .where(and(eq(taskStatuses.projectId, task.projectId), eq(taskStatuses.kind, 'review')))
      .get()!;
    const sortKey = nextTaskKey(db, review.id);

    db.transaction((tx) => {
      const { latest } = tx
        .select({ latest: sql<number>`coalesce(max(${deliverableVersions.number}), 0)` })
        .from(deliverableVersions)
        .where(eq(deliverableVersions.deliverableId, deliverable.id))
        .get()!;
      const number = latest + 1;
      tx.insert(deliverableVersions)
        .values({
          id: randomUUID(),
          deliverableId: deliverable.id,
          number,
          fileId: file.id,
          note: parsed.data.note ?? null,
          state: 'pending',
          submittedBy: auth.user.id,
          submittedAt: new Date(),
        })
        .run();
      tx.insert(taskFiles)
        .values({ taskId: task.id, fileId: file.id, addedBy: auth.user.id, addedAt: new Date() })
        .onConflictDoNothing()
        .run();
      tx.update(tasks)
        .set({ statusId: review.id, sortKey, updatedAt: new Date() })
        .where(eq(tasks.id, task.id))
        .run();
      recordHistory(tx, task.id, auth.user.id, {
        event: 'submitted',
        name: deliverable.name,
        number,
      });
      notify(tx, hub, {
        to: taskAudience(tx, task.id),
        actorId: auth.user.id,
        kind: 'status',
        projectId: task.projectId,
        taskId: task.id,
        detail: review.name,
      });
    });
    changed(task.projectId, task.id);
    return reply.code(201).send(readDeliverables(eq(deliverables.id, deliverable.id))[0]);
  });

  /**
   * A manager's decision on a version: approve it (the task moves to Approved) or ask for changes
   * (the task moves to Changes requested). The artist hears about it. Only a manager or admin may
   * decide; nobody decides their own work. Only the latest version of a task that is in review can
   * be decided, and only once.
   */
  app.post('/versions/:id/reviews', { preHandler: signedIn }, async (request, reply) => {
    const version = db
      .select()
      .from(deliverableVersions)
      .where(eq(deliverableVersions.id, paramId(request)))
      .get();
    const deliverable =
      version &&
      db.select().from(deliverables).where(eq(deliverables.id, version.deliverableId)).get();
    if (!version || !deliverable) return sendError(reply, 404, 'not_found', 'Version not found');
    const task = loadTask(request, reply, 'manage', deliverable.taskId);
    if (!task) return;
    const auth = request.auth!;
    if (version.submittedBy === auth.user.id) {
      return sendError(reply, 403, 'forbidden', 'You cannot review your own work');
    }

    const current = db.select().from(taskStatuses).where(eq(taskStatuses.id, task.statusId)).get()!;
    if (current.kind !== 'review') {
      return sendError(reply, 409, 'not_in_review', 'This task is not waiting for review');
    }
    if (version.state !== 'pending') {
      return sendError(reply, 409, 'already_reviewed', 'This version has already been reviewed');
    }
    const { latest } = db
      .select({ latest: sql<number>`coalesce(max(${deliverableVersions.number}), 0)` })
      .from(deliverableVersions)
      .where(eq(deliverableVersions.deliverableId, deliverable.id))
      .get()!;
    if (version.number !== latest) {
      return sendError(reply, 409, 'not_latest', 'A newer version was sent; review that one');
    }
    const parsed = reviewRequestSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);

    const { decision } = parsed.data;
    const { state, status } = DECISIONS[decision];
    const target = db
      .select()
      .from(taskStatuses)
      .where(and(eq(taskStatuses.projectId, task.projectId), eq(taskStatuses.kind, status)))
      .get()!;
    const sortKey = nextTaskKey(db, target.id);

    db.transaction((tx) => {
      tx.insert(reviews)
        .values({
          id: randomUUID(),
          versionId: version.id,
          reviewerId: auth.user.id,
          decision,
          summary: parsed.data.summary ?? null,
          createdAt: new Date(),
        })
        .run();
      tx.update(deliverableVersions)
        .set({ state })
        .where(eq(deliverableVersions.id, version.id))
        .run();
      tx.update(tasks)
        .set({ statusId: target.id, sortKey, updatedAt: new Date() })
        .where(eq(tasks.id, task.id))
        .run();
      recordHistory(tx, task.id, auth.user.id, {
        event: 'reviewed',
        name: deliverable.name,
        number: version.number,
        decision,
      });
      const assignees = tx
        .select({ userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, task.id))
        .all()
        .map((a) => a.userId);
      notify(tx, hub, {
        to: assignees,
        actorId: auth.user.id,
        kind: 'status',
        projectId: task.projectId,
        taskId: task.id,
        detail: target.name,
      });
    });
    changed(task.projectId, task.id);
    return reply.code(201).send(readDeliverables(eq(deliverables.id, deliverable.id))[0]);
  });

  /**
   * Two versions side by side. Both must be of the same deliverable. The caller must see both
   * tasks first, so a stranger learns nothing about versions they cannot open.
   */
  app.get('/versions/compare', { preHandler: signedIn }, async (request, reply) => {
    const parsed = compareQuerySchema.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, parsed.error.issues[0]?.message);
    const { a, b } = parsed.data;
    const owner = (versionId: string) =>
      db
        .select({ deliverableId: deliverables.id, taskId: deliverables.taskId })
        .from(deliverableVersions)
        .innerJoin(deliverables, eq(deliverables.id, deliverableVersions.deliverableId))
        .where(eq(deliverableVersions.id, versionId))
        .get();
    const ownerA = owner(a);
    const ownerB = owner(b);
    if (!ownerA || !ownerB) return sendError(reply, 404, 'not_found', 'Version not found');
    if (!loadTask(request, reply, 'view', ownerA.taskId)) return;
    if (!loadTask(request, reply, 'view', ownerB.taskId)) return;
    if (ownerA.deliverableId !== ownerB.deliverableId) {
      return sendError(
        reply,
        400,
        'different_deliverables',
        'Only versions of the same deliverable can be compared',
      );
    }
    const [deliverable] = readDeliverables(eq(deliverables.id, ownerA.deliverableId));
    const pick = (id: string) => deliverable!.versions.find((v) => v.id === id)!;
    return versionCompareSchema.parse({ deliverable: deliverable!.name, a: pick(a), b: pick(b) });
  });
};
