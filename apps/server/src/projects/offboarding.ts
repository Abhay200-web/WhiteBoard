import { openTaskListSchema } from '@whiteboard/core';
import {
  memberships,
  projectMembers,
  projects,
  taskAssignees,
  taskStatuses,
  tasks,
  users,
  type Db,
  type DbTx,
} from '@whiteboard/db';
import { and, eq, gt, inArray, isNull, ne, notInArray, or } from 'drizzle-orm';

import type { EventHub } from '../events/hub';
import { recordHistory } from './history';
import { announceTaskChange, notify } from './notify';

/** Unfinished tasks (not approved or done) assigned to this person, in any project. */
function openTaskRows(db: Db | DbTx, userId: string) {
  return db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      projectId: tasks.projectId,
      projectName: projects.name,
    })
    .from(taskAssignees)
    .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
    .innerJoin(taskStatuses, eq(taskStatuses.id, tasks.statusId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(eq(taskAssignees.userId, userId), notInArray(taskStatuses.kind, ['approved', 'done'])),
    )
    .all();
}

/**
 * The person's open tasks, each with who could take it over: the other current members of that
 * project (not removed, access not expired). For the remove dialog.
 */
export function openTasksOf(db: Db, userId: string) {
  const rows = openTaskRows(db, userId);
  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const people =
    projectIds.length === 0
      ? []
      : db
          .select({ projectId: projectMembers.projectId, userId: users.id, name: users.name })
          .from(projectMembers)
          .innerJoin(users, eq(users.id, projectMembers.userId))
          .innerJoin(memberships, eq(memberships.userId, projectMembers.userId))
          .where(
            and(
              inArray(projectMembers.projectId, projectIds),
              ne(projectMembers.userId, userId),
              isNull(memberships.removedAt),
              or(isNull(memberships.expiresAt), gt(memberships.expiresAt, new Date())),
            ),
          )
          .orderBy(users.name)
          .all();
  return openTaskListSchema.parse(
    rows.map((r) => ({
      ...r,
      candidates: people
        .filter((p) => p.projectId === r.projectId)
        .map(({ userId: id, name }) => ({ userId: id, name })),
    })),
  );
}

/**
 * Takes the person off all their open tasks, handing each to `reassign.get(taskId)` or leaving
 * it unassigned; records it in each task's history and tells whoever needs to know. Call it in
 * the transaction that removes them. Returns the tasks touched, to announce after commit.
 *
 * - by an admin (`auto: false`): new assignees are told they were assigned;
 * - access ran out (`auto: true`, actor = the person): the project's managers are told.
 */
export function handOverTasks(
  tx: DbTx,
  hub: EventHub,
  o: { userId: string; actorId: string; reassign: Map<string, string>; auto: boolean },
): { projectId: string; taskId: string }[] {
  const open = openTaskRows(tx, o.userId);
  const names = new Map(
    tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, [o.userId, ...o.reassign.values()]))
      .all()
      .map((u) => [u.id, u.name]),
  );
  for (const t of open) {
    const to = o.reassign.get(t.taskId) ?? null;
    tx.delete(taskAssignees)
      .where(and(eq(taskAssignees.taskId, t.taskId), eq(taskAssignees.userId, o.userId)))
      .run();
    if (to)
      tx.insert(taskAssignees).values({ taskId: t.taskId, userId: to }).onConflictDoNothing().run();
    tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, t.taskId)).run();
    recordHistory(tx, t.taskId, o.actorId, {
      event: 'left',
      name: names.get(o.userId)!,
      to: to && names.get(to)!,
      auto: o.auto,
    });
    const about = { actorId: o.actorId, projectId: t.projectId, taskId: t.taskId };
    if (to) notify(tx, hub, { ...about, to: [to], kind: 'assigned' });
    if (o.auto) {
      const managers = tx
        .select({ userId: projectMembers.userId })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, t.projectId), eq(projectMembers.role, 'manager')))
        .all()
        .map((m) => m.userId);
      notify(tx, hub, { ...about, to: managers, kind: 'access_ended' });
    }
  }
  return open.map(({ projectId, taskId }) => ({ projectId, taskId }));
}

/** After the removal commits: open boards and drawers reload the tasks that changed hands. */
export function announceHandOver(
  db: Db,
  hub: EventHub,
  touched: { projectId: string; taskId: string }[],
) {
  for (const { projectId, taskId } of touched) announceTaskChange(db, hub, projectId, taskId);
}
