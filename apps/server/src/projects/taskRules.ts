import type { TaskStatusKind } from '@whiteboard/core';

/** The only moves an assignee (artist) may make. Everything else needs a manager or admin. */
const ASSIGNEE_MOVES: Partial<Record<TaskStatusKind, readonly TaskStatusKind[]>> = {
  todo: ['doing'],
  doing: ['todo'],
  changes: ['doing'],
};

/**
 * Whether a task may move between two status kinds. Nobody moves a task into review by hand:
 * "Submit for review" (Part 5) does that, so approval always follows a real submission.
 */
export function canMoveTask(from: TaskStatusKind, to: TaskStatusKind, isManager: boolean): boolean {
  if (from === to) return true;
  if (to === 'review') return false;
  return isManager || (ASSIGNEE_MOVES[from]?.includes(to) ?? false);
}
