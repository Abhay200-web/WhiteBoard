import type { Task } from '@whiteboard/core';

import { formatDate, PRIORITY_LABEL } from '../format';

/** Assignees, priority, due date and checklist progress: shown on list rows and board cards. */
export function TaskMeta({ task }: { task: Task }) {
  const { done, total } = task.subtaskCounts;
  return (
    <>
      <span className="text-muted">
        {task.assignees.map((a) => a.name).join(', ') || 'Unassigned'}
      </span>
      <span>{PRIORITY_LABEL[task.priority]}</span>
      {task.dueAt !== null && <span className="text-muted">Due {formatDate(task.dueAt)}</span>}
      {total > 0 && (
        <span className="text-muted">
          {done}/{total} done
        </span>
      )}
    </>
  );
}
