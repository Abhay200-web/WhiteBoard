import { useQuery, useQueryClient } from '@tanstack/react-query';
import { myTaskListSchema, type MyTask } from '@whiteboard/core';
import { Card, Spinner } from '@whiteboard/ui';
import { useState } from 'react';

import { useAuth } from '../../auth/AuthProvider';
import { FormError } from '../../components/AuthShell';
import { api } from '../../lib/api';
import { useStatuses, useTasks } from '../projects/tasks/queries';
import { TaskDrawer } from '../projects/tasks/TaskDrawer';
import { TaskMeta } from '../projects/tasks/TaskMeta';
import { canManageProject, useProject } from '../projects/useProject';

export const DUE_GROUPS = ['Overdue', 'Today', 'This week', 'Later'] as const;
export type DueGroup = (typeof DUE_GROUPS)[number];

/** Which "My tasks" group a due date falls in, by the user's own clock. No date means Later. */
export function dueGroup(dueAt: number | null, now = new Date()): DueGroup {
  if (dueAt === null) return 'Later';
  if (dueAt < now.getTime()) return 'Overdue';
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  if (dueAt <= endOfToday.getTime()) return 'Today';
  const endOfWeek = new Date(endOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 6);
  return dueAt <= endOfWeek.getTime() ? 'This week' : 'Later';
}

const byDue = (a: MyTask, b: MyTask) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);

/**
 * Opens a task from another page in the same drawer as the project page. It reads the task from
 * its project's task list, so edits show at once exactly as they do there.
 */
function OpenTask({ task, onClose }: { task: MyTask; onClose: () => void }) {
  const { user } = useAuth();
  const project = useProject(task.projectId);
  const statuses = useStatuses(task.projectId);
  const live = useTasks(task.projectId).data?.find((t) => t.id === task.id);
  if (!project.data || !statuses.data || !live) return null;
  return (
    <TaskDrawer
      task={live}
      project={project.data}
      statuses={statuses.data}
      canManage={canManageProject(user, project.data)}
      onClose={onClose}
    />
  );
}

function TaskLines({ tasks, onOpen }: { tasks: MyTask[]; onOpen: (task: MyTask) => void }) {
  return (
    <ul className="divide-y divide-line">
      {tasks.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left font-medium text-accent underline"
            onClick={() => onOpen(t)}
          >
            {t.title}
          </button>
          <span className="text-muted">
            {t.projectName} · {t.statusName}
          </span>
          <TaskMeta task={t} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Tasks from every project, from `path` (`/me/tasks` or `/me/review-queue`). `grouped` sorts
 * them into Overdue / Today / This week / Later; otherwise one list, soonest due first.
 */
export function TaskInbox({
  title,
  path,
  empty,
  grouped,
}: {
  title: string;
  path: string;
  empty: string;
  grouped: boolean;
}) {
  const queryClient = useQueryClient();
  const tasks = useQuery({
    queryKey: ['me', path],
    queryFn: () => api(path, { schema: myTaskListSchema }),
  });
  const [open, setOpen] = useState<MyTask | null>(null);
  const now = new Date();
  const sorted = [...(tasks.data ?? [])].sort(byDue);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{title}</h1>
      {tasks.isPending && <Spinner />}
      <FormError message={tasks.isError ? 'Could not load the tasks.' : null} />
      {tasks.data?.length === 0 && <p className="text-sm text-muted">{empty}</p>}
      {sorted.length > 0 && !grouped && (
        <Card>
          <TaskLines tasks={sorted} onOpen={setOpen} />
        </Card>
      )}
      {grouped &&
        DUE_GROUPS.map((group) => {
          const inGroup = sorted.filter((t) => dueGroup(t.dueAt, now) === group);
          if (inGroup.length === 0) return null;
          return (
            <Card key={group}>
              <section aria-label={group}>
                <h2 className="font-semibold">
                  {group} ({inGroup.length})
                </h2>
                <TaskLines tasks={inGroup} onOpen={setOpen} />
              </section>
            </Card>
          );
        })}
      {open && (
        <OpenTask
          task={open}
          onClose={() => {
            setOpen(null);
            void queryClient.invalidateQueries({ queryKey: ['me'] }); // statuses may have changed
          }}
        />
      )}
    </div>
  );
}
