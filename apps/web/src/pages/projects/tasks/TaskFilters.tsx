import {
  TASK_PRIORITIES,
  type ProjectMember,
  type TaskFilter,
  type TaskStatus,
} from '@whiteboard/core';
import { Button, Input, Select } from '@whiteboard/ui';
import { useState, type FormEvent } from 'react';

import { FormError } from '../../../components/AuthShell';
import { errorText } from '../../../lib/api';
import { PRIORITY_LABEL } from '../format';
import { hasTaskFilter, sameTaskFilter } from './filters';
import { useCreateSavedFilter, useDeleteSavedFilter, useSavedFilters } from './queries';

/**
 * Narrows the project's tasks by status, priority and person, and keeps named views of those
 * choices for this person (saved on the Host, so they are there on any computer they sign in to).
 */
export function TaskFilters({
  projectId,
  statuses,
  members,
  filter,
  onChange,
}: {
  projectId: string;
  statuses: TaskStatus[];
  members: ProjectMember[];
  filter: TaskFilter;
  onChange: (filter: TaskFilter) => void;
}) {
  const views = useSavedFilters(projectId);
  const save = useCreateSavedFilter(projectId);
  const remove = useDeleteSavedFilter(projectId);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const active = hasTaskFilter(filter);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    await save.mutateAsync({ name, filter });
    setName('');
    setNaming(false);
  };

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by status"
          className="w-40"
          value={filter.statusId ?? ''}
          onChange={(e) => onChange({ ...filter, statusId: e.target.value || null })}
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by priority"
          className="w-36"
          value={filter.priority ?? ''}
          onChange={(e) =>
            onChange({ ...filter, priority: (e.target.value || null) as TaskFilter['priority'] })
          }
        >
          <option value="">Any priority</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by person"
          className="w-40"
          value={filter.assigneeId ?? ''}
          onChange={(e) => onChange({ ...filter, assigneeId: e.target.value || null })}
        >
          <option value="">Anyone</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
        {active && (
          <>
            <Button variant="ghost" onClick={() => onChange({})}>
              Clear filters
            </Button>
            {!naming && (
              <Button variant="ghost" onClick={() => setNaming(true)}>
                Save view
              </Button>
            )}
          </>
        )}
      </div>

      {naming && (
        <form onSubmit={onSave} className="flex flex-wrap items-end gap-2">
          <Input
            aria-label="View name"
            placeholder="Name this view"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <Button type="submit" disabled={save.isPending || name.trim() === ''}>
            Save view
          </Button>
          <Button variant="ghost" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </form>
      )}
      <FormError message={errorText(save.error, remove.error)} />

      {views.data && views.data.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Saved views">
          {views.data.map((v) => (
            <li key={v.id} className="flex items-center gap-1">
              <Button
                variant="ghost"
                aria-pressed={sameTaskFilter(v.filter, filter)}
                onClick={() => onChange(v.filter)}
              >
                {v.name}
              </Button>
              <Button
                variant="ghost"
                aria-label={`Delete view ${v.name}`}
                onClick={() => remove.mutate(v.id)}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
