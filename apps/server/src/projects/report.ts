import {
  DUE_SOON_MS,
  type ProjectReport,
  projectReportSchema,
  type TaskStatusKind,
} from '@whiteboard/core';
import {
  deliverableVersions,
  deliverables,
  reviews,
  taskAssignees,
  taskStatuses,
  tasks,
  users,
  type Db,
} from '@whiteboard/db';
import { and, eq } from 'drizzle-orm';

export interface ReportInput {
  statuses: { id: string; name: string; kind: TaskStatusKind; sortKey: number }[];
  tasks: { id: string; statusId: string; dueAt: number | null }[];
  /** Who is assigned to each task. */
  assignees: { taskId: string; userId: string; name: string }[];
  /** Versions of the project's deliverables that are still waiting for a decision. */
  waiting: number;
  /** Decisions on the project's versions, and how long each took (ms from submission). */
  decisions: { decision: 'approve' | 'changes'; waitMs: number }[];
}

/** Turns the project's rows into the dashboard numbers. Pure, so it can be tested without a Host. */
export function buildReport(input: ReportInput, now: number): ProjectReport {
  const kindOf = new Map(input.statuses.map((s) => [s.id, s.kind]));
  const open = input.tasks.filter((t) => kindOf.get(t.statusId) !== 'done');
  const overdue = (t: { dueAt: number | null }) => t.dueAt !== null && t.dueAt < now;
  const soonLimit = now + DUE_SOON_MS;

  const openById = new Map(open.map((t) => [t.id, t]));
  const workloadBy = new Map<
    string,
    { userId: string; name: string; open: Set<string>; overdue: Set<string> }
  >();
  const assignedOpen = new Set<string>();
  for (const a of input.assignees) {
    const task = openById.get(a.taskId);
    if (!task) continue;
    assignedOpen.add(task.id);
    const row = workloadBy.get(a.userId) ?? {
      userId: a.userId,
      name: a.name,
      open: new Set<string>(),
      overdue: new Set<string>(),
    };
    row.open.add(task.id);
    if (overdue(task)) row.overdue.add(task.id);
    workloadBy.set(a.userId, row);
  }

  const decided = input.decisions;
  const waitTotal = decided.reduce((sum, d) => sum + d.waitMs, 0);

  return projectReportSchema.parse({
    generatedAt: now,
    progress: {
      total: input.tasks.length,
      done: input.tasks.length - open.length,
      open: open.length,
      overdue: open.filter(overdue).length,
      dueSoon: open.filter((t) => t.dueAt !== null && t.dueAt >= now && t.dueAt <= soonLimit)
        .length,
    },
    byStatus: [...input.statuses]
      .sort((a, b) => a.sortKey - b.sortKey)
      .map((s) => ({
        statusId: s.id,
        name: s.name,
        kind: s.kind,
        count: input.tasks.filter((t) => t.statusId === s.id).length,
      })),
    workload: [...workloadBy.values()]
      .map((w) => ({ userId: w.userId, name: w.name, open: w.open.size, overdue: w.overdue.size }))
      .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
    unassigned: open.filter((t) => !assignedOpen.has(t.id)).length,
    reviews: {
      waiting: input.waiting,
      approved: decided.filter((d) => d.decision === 'approve').length,
      changesRequested: decided.filter((d) => d.decision === 'changes').length,
      averageHours:
        decided.length === 0
          ? null
          : Math.round((waitTotal / decided.length / 3_600_000) * 10) / 10,
    },
  });
}

/** Reads the project's rows and builds its report. */
export function projectReport(db: Db, projectId: string, now = Date.now()): ProjectReport {
  const statuses = db
    .select({
      id: taskStatuses.id,
      name: taskStatuses.name,
      kind: taskStatuses.kind,
      sortKey: taskStatuses.sortKey,
    })
    .from(taskStatuses)
    .where(eq(taskStatuses.projectId, projectId))
    .all();
  const projectTasks = db
    .select({ id: tasks.id, statusId: tasks.statusId, dueAt: tasks.dueAt })
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .all();
  const assignees = db
    .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId, name: users.name })
    .from(taskAssignees)
    .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
    .innerJoin(users, eq(users.id, taskAssignees.userId))
    .where(eq(tasks.projectId, projectId))
    .all();
  const waiting = db
    .select({ id: deliverableVersions.id })
    .from(deliverableVersions)
    .innerJoin(deliverables, eq(deliverables.id, deliverableVersions.deliverableId))
    .innerJoin(tasks, eq(tasks.id, deliverables.taskId))
    .where(and(eq(tasks.projectId, projectId), eq(deliverableVersions.state, 'pending')))
    .all().length;
  const decisions = db
    .select({
      decision: reviews.decision,
      submittedAt: deliverableVersions.submittedAt,
      decidedAt: reviews.createdAt,
    })
    .from(reviews)
    .innerJoin(deliverableVersions, eq(deliverableVersions.id, reviews.versionId))
    .innerJoin(deliverables, eq(deliverables.id, deliverableVersions.deliverableId))
    .innerJoin(tasks, eq(tasks.id, deliverables.taskId))
    .where(eq(tasks.projectId, projectId))
    .all();

  return buildReport(
    {
      statuses,
      tasks: projectTasks.map((t) => ({ ...t, dueAt: t.dueAt ? t.dueAt.getTime() : null })),
      assignees,
      waiting,
      decisions: decisions.map((d) => ({
        decision: d.decision,
        waitMs: d.decidedAt.getTime() - d.submittedAt.getTime(),
      })),
    },
    now,
  );
}
