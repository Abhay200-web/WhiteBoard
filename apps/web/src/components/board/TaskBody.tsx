import { errorText } from '../../lib/api';
import { formatDate } from '../../pages/projects/format';
import { useStatuses, useTask } from '../../pages/projects/tasks/queries';

/** A task from the project, as a board card: its title, status, people and due date. */
export function TaskBody({ taskId, projectId }: { taskId: string; projectId: string }) {
  const task = useTask(taskId);
  const statuses = useStatuses(projectId);
  if (task.isError) {
    return <p className="p-2 text-sm text-muted">{errorText(task.error)}</p>;
  }
  if (!task.data) return <p className="p-2 text-sm text-muted">Loading task…</p>;
  const t = task.data;
  const status = statuses.data?.find((s) => s.id === t.statusId)?.name ?? '';
  return (
    <div className="flex h-full flex-col gap-1 p-3 text-sm">
      <span className="line-clamp-2 font-medium">{t.title}</span>
      <span className="text-xs text-muted">
        {status}
        {t.dueAt !== null && ` · due ${formatDate(t.dueAt)}`}
      </span>
      {t.assignees.length > 0 && (
        <span className="mt-auto truncate text-xs text-muted">
          {t.assignees.map((a) => a.name).join(', ')}
        </span>
      )}
    </div>
  );
}
