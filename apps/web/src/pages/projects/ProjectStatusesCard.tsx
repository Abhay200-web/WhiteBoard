import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TASK_STATUS_KIND_LABEL,
  TASK_STATUS_KINDS,
  taskStatusListSchema,
  type TaskStatus,
  type TaskStatusKind,
} from '@whiteboard/core';
import { Button, Card, Field, Input, Select } from '@whiteboard/ui';
import { useState, type FormEvent } from 'react';

import { FormError } from '../../components/AuthShell';
import { api, errorText } from '../../lib/api';
import { useStatuses } from './tasks/queries';

/**
 * A project's task statuses, for its managers: add, rename, move up or down, delete. Each
 * status behaves like one of the six kinds, which decides who may move tasks there and what
 * review does with it.
 */
export function ProjectStatusesCard({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const statuses = useStatuses(projectId);
  const url = `/projects/${projectId}/statuses`;

  const change = useMutation({
    mutationFn: (request: {
      method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
      path?: string;
      body?: object;
    }) =>
      api(`${url}${request.path ?? ''}`, {
        method: request.method,
        body: request.body,
        schema: taskStatusListSchema,
      }),
    onSuccess: (list) => {
      queryClient.setQueryData(['statuses', projectId], list);
      void queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['report', projectId] });
    },
  });

  const list = statuses.data ?? [];
  function move(index: number, by: -1 | 1) {
    const ids = list.map((s) => s.id);
    [ids[index], ids[index + by]] = [ids[index + by]!, ids[index]!];
    change.mutate({ method: 'PUT', path: '/order', body: { ids } });
  }

  return (
    <Card>
      <h2 className="font-semibold">Task statuses</h2>
      <p className="mt-1 text-sm text-muted">
        The columns of the task board, in order. Each one behaves like one of the six built-in
        steps, and every step keeps at least one status.
      </p>
      <ul aria-label="Task statuses" className="mt-2 divide-y divide-line">
        {list.map((status, i) => (
          <StatusRow
            key={status.id}
            status={status}
            first={i === 0}
            last={i === list.length - 1}
            busy={change.isPending}
            onRename={(name) =>
              change.mutate({ method: 'PATCH', path: `/${status.id}`, body: { name } })
            }
            onMove={(by) => move(i, by)}
            onDelete={() => change.mutate({ method: 'DELETE', path: `/${status.id}` })}
          />
        ))}
      </ul>
      <FormError message={errorText(change.error)} />
      <AddStatus
        busy={change.isPending}
        onAdd={(body) => change.mutate({ method: 'POST', body })}
      />
    </Card>
  );
}

function StatusRow({
  status,
  first,
  last,
  busy,
  onRename,
  onMove,
  onDelete,
}: {
  status: TaskStatus;
  first: boolean;
  last: boolean;
  busy: boolean;
  onRename: (name: string) => void;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name');
    if (typeof name === 'string' && name.trim() && name.trim() !== status.name) onRename(name);
    setEditing(false);
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      {editing ? (
        <form onSubmit={onSubmit} className="flex flex-1 items-center gap-2">
          <Input
            name="name"
            aria-label={`New name for ${status.name}`}
            defaultValue={status.name}
            maxLength={60}
            autoFocus
            className="max-w-64"
          />
          <Button type="submit">Save</Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <span>
          <span className="font-medium">{status.name}</span>
          <span className="text-muted"> · behaves like {TASK_STATUS_KIND_LABEL[status.kind]}</span>
        </span>
      )}
      {!editing && (
        <span className="flex items-center gap-1">
          <Button
            variant="ghost"
            aria-label={`Rename ${status.name}`}
            onClick={() => setEditing(true)}
          >
            Rename
          </Button>
          <Button
            variant="ghost"
            aria-label={`Move ${status.name} up`}
            disabled={first || busy}
            onClick={() => onMove(-1)}
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            aria-label={`Move ${status.name} down`}
            disabled={last || busy}
            onClick={() => onMove(1)}
          >
            ↓
          </Button>
          <Button
            variant="ghost"
            aria-label={`Delete ${status.name}`}
            disabled={busy}
            onClick={onDelete}
          >
            Delete
          </Button>
        </span>
      )}
    </li>
  );
}

function AddStatus({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (body: { name: string; kind: TaskStatusKind }) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TaskStatusKind>('doing');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onAdd({ name, kind });
    setName('');
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-3">
      <div className="min-w-48 flex-1">
        <Field label="New status">
          <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <div className="w-48">
        <Field label="Behaves like">
          <Select value={kind} onChange={(e) => setKind(e.target.value as TaskStatusKind)}>
            {TASK_STATUS_KINDS.map((k) => (
              <option key={k} value={k}>
                {TASK_STATUS_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Button type="submit" disabled={!name.trim()} loading={busy}>
        Add status
      </Button>
    </form>
  );
}
