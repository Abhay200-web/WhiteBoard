import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  canMoveTask,
  subtaskListSchema,
  taskSchema,
  TASK_PRIORITIES,
  type ProjectDetail,
  type Subtask,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '@whiteboard/core';
import {
  isRichTextEmpty,
  RichTextEditor,
  RichTextView,
  type RichTextDoc,
} from '@whiteboard/editor';
import { Button, Field, Input, Modal, Select } from '@whiteboard/ui';
import { useRef, useState } from 'react';

import { useAuth } from '../../../auth/AuthProvider';
import { FormError } from '../../../components/AuthShell';
import { api, errorText } from '../../../lib/api';
import { AttachedFiles } from '../AttachedFiles';
import { PRIORITY_LABEL, toDateTimeInput } from '../format';
import { AddTitleForm } from './AddTitleForm';
import { patchTask, tasksKey, useUpdateTask } from './queries';

/**
 * Checklist. Managers add and delete items; managers and assignees tick them. `onChange` gets
 * the new list after every change, so the task's done/total counts stay right without a refetch.
 */
function Checklist({
  taskId,
  canManage,
  canTick,
  onChange,
}: {
  taskId: string;
  canManage: boolean;
  canTick: boolean;
  onChange: (list: Subtask[]) => void;
}) {
  const queryClient = useQueryClient();
  const key = ['subtasks', taskId];
  const items = useQuery({
    queryKey: key,
    queryFn: () => api(`/tasks/${taskId}/subtasks`, { schema: subtaskListSchema }),
  });
  const saved = (list: Subtask[]) => {
    queryClient.setQueryData(key, list);
    onChange(list);
  };
  const add = useMutation({
    mutationFn: (title: string) =>
      api(`/tasks/${taskId}/subtasks`, {
        method: 'POST',
        body: { title },
        schema: subtaskListSchema,
      }),
    onSuccess: saved,
  });
  const tick = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api(`/subtasks/${id}`, { method: 'PATCH', body: { done }, schema: subtaskListSchema }),
    onSuccess: saved,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/subtasks/${id}`, { method: 'DELETE' }),
    onSuccess: (_none, id) => saved((items.data ?? []).filter((s) => s.id !== id)),
  });

  return (
    <div>
      {items.data && items.data.length > 0 && (
        <ul aria-label="Checklist" className="flex flex-col gap-1">
          {items.data.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm">
              <label className="flex flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={s.done}
                  disabled={!canTick}
                  onChange={(e) => tick.mutate({ id: s.id, done: e.target.checked })}
                />
                <span className={s.done ? 'text-muted line-through' : undefined}>{s.title}</span>
              </label>
              {canManage && (
                <Button
                  variant="ghost"
                  aria-label={`Delete ${s.title}`}
                  onClick={() => remove.mutate(s.id)}
                >
                  Delete
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {items.data?.length === 0 && <p className="text-sm text-muted">No checklist items.</p>}
      {canManage && (
        <AddTitleForm
          label="New checklist item"
          placeholder="Add an item"
          button="Add"
          onAdd={add.mutateAsync}
        />
      )}
      <FormError message={errorText(add.error, tick.error, remove.error)} />
    </div>
  );
}

/**
 * One task in a side panel. Managers edit everything; an assignee can only make the status
 * moves the rules allow and tick checklist items. Fields save when they lose focus.
 */
export function TaskDrawer({
  task,
  project,
  statuses,
  canManage,
  onClose,
}: {
  task: Task;
  project: ProjectDetail;
  statuses: TaskStatus[];
  canManage: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const update = useUpdateTask(project.id);
  const description = useRef<RichTextDoc | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const dueInput = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const patch = (change: Partial<Task> | null) =>
    patchTask(queryClient, project.id, task.id, change);

  const setAssignees = useMutation({
    mutationFn: (userIds: string[]) =>
      api(`/tasks/${task.id}/assignees`, {
        method: 'PUT',
        body: { userIds },
        schema: taskSchema,
      }),
    onSuccess: patch,
  });
  const remove = useMutation({
    mutationFn: () => api(`/tasks/${task.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      onClose();
      patch(null);
    },
  });

  const assigned = new Set(task.assignees.map((a) => a.userId));
  const isAssignee = !!user && assigned.has(user.id);
  const current = statuses.find((s) => s.id === task.statusId);
  const moves = current ? statuses.filter((s) => canMoveTask(current.kind, s.kind, canManage)) : [];
  const hasDescription = !!task.description && !isRichTextEmpty(task.description);

  function toggleAssignee(userId: string) {
    const next = new Set(assigned);
    if (!next.delete(userId)) next.add(userId);
    setAssignees.mutate([...next]);
  }

  // Fields save when they lose focus, and on close (Escape or a backdrop click close the
  // drawer without a blur). If the Host refuses, the field shows the saved value again.
  function saveTitle() {
    const input = titleInput.current;
    const title = input?.value.trim();
    if (!input || !title || title === task.title) return;
    const saved = task.title;
    update.mutate({ id: task.id, title }, { onError: () => (input.value = saved) });
  }

  function saveDue() {
    const input = dueInput.current;
    const saved = toDateTimeInput(task.dueAt);
    // A half-typed date reads as '' (badInput): keep the saved due date rather than clear it.
    if (!input || input.validity.badInput || input.value === saved) return;
    const dueAt = input.value ? new Date(input.value).getTime() : null;
    update.mutate({ id: task.id, dueAt }, { onError: () => (input.value = saved) });
  }

  function saveDescription() {
    if (!description.current) return;
    const doc = description.current;
    description.current = null;
    update.mutate({ id: task.id, description: isRichTextEmpty(doc) ? null : doc });
  }

  function close() {
    if (canManage) {
      saveTitle();
      saveDue();
      saveDescription();
    }
    onClose();
  }

  return (
    <Modal title={task.title} placement="right" size="lg" onClose={close}>
      <div className="flex flex-col gap-5">
        {canManage && (
          <Field label="Title">
            <Input ref={titleInput} defaultValue={task.title} onBlur={saveTitle} />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Status">
            <Select
              value={task.statusId}
              disabled={!canManage && !isAssignee}
              onChange={(e) => update.mutate({ id: task.id, statusId: e.target.value })}
            >
              {moves.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select
              value={task.priority}
              disabled={!canManage}
              onChange={(e) =>
                update.mutate({ id: task.id, priority: e.target.value as TaskPriority })
              }
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due">
            <Input
              ref={dueInput}
              type="datetime-local"
              defaultValue={toDateTimeInput(task.dueAt)}
              disabled={!canManage}
              onBlur={saveDue}
            />
          </Field>
        </div>
        <FormError message={errorText(update.error, setAssignees.error, remove.error)} />

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Assignees</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {project.members.map((m) => (
              <label key={m.userId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={assigned.has(m.userId)}
                  disabled={!canManage || setAssignees.isPending}
                  onChange={() => toggleAssignee(m.userId)}
                />
                {m.name}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <h3 className="mb-1.5 text-sm font-medium">Description</h3>
          {canManage && (
            <div
              onBlur={(e) => {
                // Toolbar clicks move focus inside the editor box; save only when it leaves.
                if (!e.currentTarget.contains(e.relatedTarget)) saveDescription();
              }}
            >
              <RichTextEditor
                label="Description"
                value={task.description}
                onChange={(doc) => (description.current = doc)}
              />
            </div>
          )}
          {!canManage && hasDescription && <RichTextView value={task.description!} />}
          {!canManage && !hasDescription && <p className="text-sm text-muted">No description.</p>}
        </div>

        <div>
          <h3 className="mb-1.5 text-sm font-medium">Checklist</h3>
          <Checklist
            taskId={task.id}
            canManage={canManage}
            canTick={canManage || isAssignee}
            onChange={(list) =>
              patch({
                subtaskCounts: { done: list.filter((s) => s.done).length, total: list.length },
              })
            }
          />
        </div>

        <div>
          <h3 className="text-sm font-medium">Files</h3>
          <AttachedFiles
            path={`/tasks/${task.id}/files`}
            label="Task files"
            canManage={canManage}
            onChange={() => void queryClient.invalidateQueries({ queryKey: tasksKey(project.id) })}
          />
        </div>

        <div className="flex justify-between gap-2 border-t border-line pt-4">
          {canManage &&
            (confirmDelete ? (
              <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
                Delete for good
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete task
              </Button>
            ))}
          <Button variant="secondary" className="ml-auto" onClick={close}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
