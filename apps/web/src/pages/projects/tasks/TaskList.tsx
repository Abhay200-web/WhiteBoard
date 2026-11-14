import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TASK_PRIORITIES, taskSchema, type ProjectDetail, type Task } from '@whiteboard/core';
import { Card, Select, Spinner } from '@whiteboard/ui';
import { useState } from 'react';

import { FormError } from '../../../components/AuthShell';
import { api, errorText } from '../../../lib/api';
import { formatDate, PRIORITY_LABEL } from '../format';
import { AddTitleForm } from './AddTitleForm';
import { tasksKey, useStatuses, useTasks } from './queries';
import { TaskDrawer } from './TaskDrawer';

type SortBy = 'board' | 'due' | 'priority';

const SORTERS: Record<SortBy, (a: Task, b: Task) => number> = {
  board: (a, b) => a.sortKey - b.sortKey,
  due: (a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity),
  // TASK_PRIORITIES runs low -> urgent; most urgent first.
  priority: (a, b) => TASK_PRIORITIES.indexOf(b.priority) - TASK_PRIORITIES.indexOf(a.priority),
};

function NewTask({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (title: string) =>
      api(`/projects/${projectId}/tasks`, { method: 'POST', body: { title }, schema: taskSchema }),
    onSuccess: (task) =>
      queryClient.setQueryData<Task[]>(tasksKey(projectId), (list) => list && [...list, task]),
  });
  return (
    <>
      <AddTitleForm
        label="New task title"
        placeholder="Add a task"
        button="Add task"
        onAdd={create.mutateAsync}
      />
      <FormError message={errorText(create.error)} />
    </>
  );
}

function TaskRow({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const { done, total } = task.subtaskCounts;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left font-medium text-accent underline"
        onClick={onOpen}
      >
        {task.title}
      </button>
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
    </li>
  );
}

/** The project's tasks, grouped by status. Managers add tasks here; anyone opens one. */
export function TaskList({ project, canManage }: { project: ProjectDetail; canManage: boolean }) {
  const statuses = useStatuses(project.id);
  const tasks = useTasks(project.id);
  const [sortBy, setSortBy] = useState<SortBy>('board');
  const [openId, setOpenId] = useState<string | null>(null);
  const open = tasks.data?.find((t) => t.id === openId);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Tasks</h2>
        <Select
          aria-label="Sort tasks"
          className="w-40"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
        >
          <option value="board">Board order</option>
          <option value="due">Due date</option>
          <option value="priority">Priority</option>
        </Select>
      </div>
      {canManage && <NewTask projectId={project.id} />}

      {(tasks.isPending || statuses.isPending) && <Spinner />}
      <FormError message={tasks.isError || statuses.isError ? 'Could not load the tasks.' : null} />
      {tasks.data?.length === 0 && <p className="mt-2 text-sm text-muted">No tasks yet.</p>}
      {tasks.data &&
        statuses.data?.map((status) => {
          const column = tasks.data.filter((t) => t.statusId === status.id).sort(SORTERS[sortBy]);
          if (column.length === 0) return null;
          return (
            <section key={status.id} aria-label={status.name} className="mt-4">
              <h3 className="text-sm font-medium text-muted">
                {status.name} ({column.length})
              </h3>
              <ul className="divide-y divide-line">
                {column.map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={() => setOpenId(t.id)} />
                ))}
              </ul>
            </section>
          );
        })}

      {open && statuses.data && (
        <TaskDrawer
          key={open.id}
          task={open}
          project={project}
          statuses={statuses.data}
          canManage={canManage}
          onClose={() => setOpenId(null)}
        />
      )}
    </Card>
  );
}
