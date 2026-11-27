import {
  notificationSettings,
  projectMembers,
  projects,
  taskAssignees,
  taskStatuses,
  tasks,
  type Db,
} from '@whiteboard/db';
import { and, eq, isNotNull, lt, ne, notInArray } from 'drizzle-orm';

import type { EventHub } from '../events/hub';
import { notify } from '../projects/notify';
import { day } from '../projects/export';
import type { Job } from '../scheduler';

/** Summaries go out from this hour of the Host's day (08:00), or as soon as the Host is on after it. */
export const SUMMARY_HOUR = 8;

interface Counts {
  overdue: number;
  dueToday: number;
  toReview: number;
}

/** "2 overdue, 1 due today, 3 waiting for your review": only the parts that are not zero. */
export function summaryText({ overdue, dueToday, toReview }: Counts): string {
  const parts: string[] = [];
  if (overdue > 0) parts.push(`${overdue} overdue`);
  if (dueToday > 0) parts.push(`${dueToday} due today`);
  if (toReview > 0) parts.push(`${toReview} waiting for your review`);
  return parts.join(', ');
}

/** One person's counts, by project, for projects that are not archived. */
function countsFor(db: Db, userId: string, now: Date): Map<string, Counts> {
  const endOfDay = new Date(now);
  endOfDay.setHours(24, 0, 0, 0);
  const byProject = new Map<string, Counts>();
  const counts = (projectId: string) => {
    let c = byProject.get(projectId);
    if (!c) byProject.set(projectId, (c = { overdue: 0, dueToday: 0, toReview: 0 }));
    return c;
  };

  const mine = db
    .select({ projectId: tasks.projectId, dueAt: tasks.dueAt })
    .from(taskAssignees)
    .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
    .innerJoin(taskStatuses, eq(taskStatuses.id, tasks.statusId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(taskAssignees.userId, userId),
        isNotNull(tasks.dueAt),
        lt(tasks.dueAt, endOfDay),
        notInArray(taskStatuses.kind, ['approved', 'done']),
        ne(projects.status, 'archived'),
      ),
    )
    .all();
  for (const task of mine) {
    if (task.dueAt! < now) counts(task.projectId).overdue++;
    else counts(task.projectId).dueToday++;
  }

  const toReview = db
    .select({ projectId: tasks.projectId })
    .from(projectMembers)
    .innerJoin(tasks, eq(tasks.projectId, projectMembers.projectId))
    .innerJoin(taskStatuses, eq(taskStatuses.id, tasks.statusId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(projectMembers.userId, userId),
        eq(projectMembers.role, 'manager'),
        eq(taskStatuses.kind, 'review'),
        ne(projects.status, 'archived'),
      ),
    )
    .all();
  for (const task of toReview) counts(task.projectId).toReview++;
  return byProject;
}

/**
 * For everyone who turned the daily summary on: once per Host day, from 08:00, one bell line per
 * project with something to say. Nothing to say means no line, but the day still counts as done.
 */
export function sendDailySummaries(db: Db, hub: EventHub, now: Date): void {
  if (now.getHours() < SUMMARY_HOUR) return;
  const today = day(now.getTime());
  const people = db
    .select({ userId: notificationSettings.userId, last: notificationSettings.lastSummaryDay })
    .from(notificationSettings)
    .where(eq(notificationSettings.dailySummary, true))
    .all()
    .filter((p) => p.last !== today);
  for (const { userId } of people) {
    const byProject = countsFor(db, userId, now);
    db.transaction((tx) => {
      for (const [projectId, counts] of byProject) {
        notify(tx, hub, {
          to: [userId],
          kind: 'daily_summary',
          projectId,
          detail: summaryText(counts),
        });
      }
      tx.update(notificationSettings)
        .set({ lastSummaryDay: today })
        .where(eq(notificationSettings.userId, userId))
        .run();
    });
  }
}

/** Checked every 15 minutes, so the summary arrives soon after 08:00 or after the Host starts. */
export const dailySummaryJob = (hub: EventHub): Job => ({
  name: 'daily-summary',
  intervalMs: 15 * 60 * 1000,
  run: (db, now) => {
    sendDailySummaries(db, hub, now);
  },
});
