import { Input, Modal } from '@whiteboard/ui';
import { useState } from 'react';

import { useStatuses, useTasks } from '../../pages/projects/tasks/queries';

/** Picks a task from the project to show on the board. */
export function TaskPickDialog({
  projectId,
  onPick,
  onClose,
}: {
  projectId: string;
  onPick: (taskId: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const tasks = useTasks(projectId);
  const statuses = useStatuses(projectId);
  const shown = (tasks.data ?? []).filter((t) =>
    t.title.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <Modal title="Add a task" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Input
          aria-label="Search tasks"
          placeholder="Search by title"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul aria-label="Project tasks" className="flex max-h-72 flex-col gap-1 overflow-auto">
          {shown.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2"
                onClick={() => onPick(t.id)}
              >
                {t.title}
                <span className="ml-2 text-xs text-muted">
                  {statuses.data?.find((s) => s.id === t.statusId)?.name}
                </span>
              </button>
            </li>
          ))}
          {tasks.data && shown.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted">No tasks match.</li>
          )}
        </ul>
      </div>
    </Modal>
  );
}
