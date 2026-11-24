import { type DeadlineAlertKind } from '@whiteboard/core';
import { deadlineAlerts, taskStatuses, tasks, type Db } from '@whiteboard/db';
import { and, eq, isNotNull, lte, ne } from 'drizzle-orm';

import type { EventHub } from '../events/hub';
import { notify, taskAudience } from '../projects/notify';
import type { Job } from '../scheduler';

/** A task due within this long gets a "due soon" alert. */
export const DUE_SOON_MS = 24 * 60 * 60 * 1000;

/**
 * Tells the people on each open task that it is overdue (its due time has passed) or due soon
 * (within 24 hours). Each alert is sent once per due date: the sent alerts are stored. Only the
 * task's state now is checked, so a Host that was off catches up: a task that went overdue while
 * it was down gets "overdue", not a "due soon" it never had time for.
 */
export function sendDeadlineAlerts(db: Db, hub: EventHub, now: Date): void {
  const horizon = new Date(now.getTime() + DUE_SOON_MS);
  const due = db
    .select({ id: tasks.id, projectId: tasks.projectId, dueAt: tasks.dueAt })
    .from(tasks)
    .innerJoin(taskStatuses, eq(taskStatuses.id, tasks.statusId))
    .where(and(isNotNull(tasks.dueAt), lte(tasks.dueAt, horizon), ne(taskStatuses.kind, 'done')))
    .all();
  for (const task of due) {
    const dueAt = task.dueAt!;
    const kind: DeadlineAlertKind = dueAt <= now ? 'overdue' : 'due_soon';
    const sent = db
      .select({ taskId: deadlineAlerts.taskId })
      .from(deadlineAlerts)
      .where(
        and(
          eq(deadlineAlerts.taskId, task.id),
          eq(deadlineAlerts.kind, kind),
          eq(deadlineAlerts.dueAt, dueAt),
        ),
      )
      .get();
    if (sent) continue;
    db.transaction((tx) => {
      tx.insert(deadlineAlerts).values({ taskId: task.id, kind, dueAt, sentAt: now }).run();
      notify(tx, hub, {
        to: taskAudience(tx, task.id),
        kind,
        projectId: task.projectId,
        taskId: task.id,
      });
    });
  }
}

/** Every 15 minutes. Needs the Host's hub so open apps hear about it at once. */
export const deadlinesJob = (hub: EventHub): Job => ({
  name: 'deadlines',
  intervalMs: 15 * 60 * 1000,
  run: (db, now) => {
    sendDeadlineAlerts(db, hub, now);
  },
});
