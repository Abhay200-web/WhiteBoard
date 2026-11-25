import type { Notification } from '@whiteboard/core';

/** One sentence per notification, e.g. "Mia assigned you Logo concepts". */
export function describeNotification(n: Notification): string {
  const task = n.taskTitle ?? 'a task'; // the task may have been deleted since
  switch (n.kind) {
    case 'assigned':
      return `${n.actorName} assigned you ${task}`;
    case 'mentioned':
      return `${n.actorName} mentioned you on ${task}: “${n.detail}”`;
    case 'commented':
      return `${n.actorName} commented on ${task}: “${n.detail}”`;
    case 'status':
      return `${n.actorName} moved ${task} to ${n.detail}`;
    case 'added_to_project':
      return `${n.actorName} added you to ${n.projectName}`;
    case 'access_ended':
      return `${n.actorName}'s access ended: ${task} is now unassigned`;
    case 'due_soon':
      return `${task} is due within 24 hours`;
    case 'overdue':
      return `${task} is overdue`;
  }
}
