import { randomUUID } from 'node:crypto';

import type { NotificationKind } from '@whiteboard/core';
import { notifications, taskAssignees, tasks, type Db, type DbTx } from '@whiteboard/db';
import { eq } from 'drizzle-orm';

import type { EventHub } from '../events/hub';
import { projectViewers } from './access';

/**
 * Tells people about something, never the person who did it, and only people who can see the
 * project right now (someone taken off a project hears nothing more about it, even about tasks
 * they created). Call it inside the transaction that makes the change. The live ping goes out
 * at once: better-sqlite3 transactions run synchronously, so the rows are committed before any
 * app can ask for them.
 */
export function notify(
  tx: DbTx,
  hub: EventHub,
  n: {
    to: Iterable<string>;
    actorId: string;
    kind: NotificationKind;
    projectId: string;
    taskId?: string;
    detail?: string;
  },
): void {
  const others = [...n.to].filter((id) => id !== n.actorId);
  const recipients = projectViewers(tx, n.projectId, others);
  if (recipients.length === 0) return;
  const createdAt = new Date();
  tx.insert(notifications)
    .values(
      recipients.map((userId) => ({
        id: randomUUID(),
        userId,
        actorId: n.actorId,
        kind: n.kind,
        projectId: n.projectId,
        taskId: n.taskId ?? null,
        detail: n.detail ?? null,
        createdAt,
      })),
    )
    .run();
  hub.send(recipients, { type: 'notification' });
}

/**
 * Tells every open app that may see the project that one of its tasks changed, so boards,
 * lists and drawers reload it. Call it after the change is saved. Ids only, no content.
 */
export function announceTaskChange(db: Db, hub: EventHub, projectId: string, taskId: string) {
  const viewers = projectViewers(db, projectId, hub.connectedUsers());
  hub.send(viewers, { type: 'task.changed', projectId, taskId });
}

/** Who hears about a task's comments and moves: whoever created it and whoever works on it. */
export function taskAudience(db: Db | DbTx, taskId: string): string[] {
  const task = db
    .select({ createdBy: tasks.createdBy })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get();
  const assignees = db
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(eq(taskAssignees.taskId, taskId))
    .all()
    .map((a) => a.userId);
  return task ? [task.createdBy, ...assignees] : assignees;
}

/** The start of a comment, for the bell. */
export const excerpt = (text: string, max = 80) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
