import type { Task, TaskFilter } from '@whiteboard/core';

/** The tasks that match every field the filter sets. An empty filter matches everything. */
export function applyTaskFilter(tasks: Task[], filter: TaskFilter): Task[] {
  return tasks.filter(
    (t) =>
      (!filter.statusId || t.statusId === filter.statusId) &&
      (!filter.priority || t.priority === filter.priority) &&
      (!filter.assigneeId || t.assignees.some((a) => a.userId === filter.assigneeId)),
  );
}

/** Whether two filters set the same fields (a missing field and `null` count as the same). */
export const sameTaskFilter = (a: TaskFilter, b: TaskFilter) =>
  (a.statusId ?? null) === (b.statusId ?? null) &&
  (a.priority ?? null) === (b.priority ?? null) &&
  (a.assigneeId ?? null) === (b.assigneeId ?? null);

/** Whether any field is set. */
export const hasTaskFilter = (filter: TaskFilter) =>
  Boolean(filter.statusId || filter.priority || filter.assigneeId);
