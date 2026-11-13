import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  personListSchema,
  projectDetailSchema,
  type ProjectDetail,
  type ProjectMemberRole,
} from '@whiteboard/core';
import { Button, Card, Field, Select } from '@whiteboard/ui';
import { useState, type FormEvent } from 'react';

import { FormError } from '../../components/AuthShell';
import { api, ApiError } from '../../lib/api';
import { ROLE_LABEL } from './format';

function AddMember({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<ProjectMemberRole>('artist');
  const people = useQuery({
    queryKey: ['people'],
    queryFn: () => api('/people', { schema: personListSchema }),
  });
  const add = useMutation({
    mutationFn: (body: { userId: string; role: ProjectMemberRole }) =>
      api(`/projects/${project.id}/members`, {
        method: 'POST',
        body,
        schema: projectDetailSchema,
      }),
    onSuccess: async () => {
      setUserId('');
      await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const onProject = new Set(project.members.map((m) => m.userId));
  const candidates = (people.data ?? []).filter((p) => !onProject.has(p.id));
  const picked = candidates.find((p) => p.id === userId);
  // Freelancers (guests) can only be artists.
  const effectiveRole: ProjectMemberRole = picked?.role === 'guest' ? 'artist' : role;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (userId) add.mutate({ userId, role: effectiveRole });
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-3">
      <div className="min-w-48 flex-1">
        <Field label="Add a person">
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose...</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.role === 'guest' ? 'freelancer' : p.role})
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="w-36">
        <Field label="Project role">
          <Select
            value={effectiveRole}
            disabled={picked?.role === 'guest'}
            onChange={(e) => setRole(e.target.value as ProjectMemberRole)}
          >
            <option value="artist">{ROLE_LABEL.artist}</option>
            <option value="manager">{ROLE_LABEL.manager}</option>
          </Select>
        </Field>
      </div>
      <Button type="submit" disabled={!userId} loading={add.isPending}>
        Add to project
      </Button>
      <FormError message={add.error instanceof ApiError ? add.error.message : null} />
    </form>
  );
}

export function ProjectMembersCard({
  project,
  canManage,
}: {
  project: ProjectDetail;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (userId: string) =>
      api(`/projects/${project.id}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  return (
    <Card>
      <h2 className="font-semibold">People</h2>
      <ul aria-label="Project members" className="mt-2 divide-y divide-line">
        {project.members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              <span className="font-medium">{m.name}</span>
              <span className="text-muted"> · {m.email}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="text-muted">{ROLE_LABEL[m.role]}</span>
              {canManage && (
                <Button
                  variant="ghost"
                  aria-label={`Remove ${m.name}`}
                  loading={remove.isPending && remove.variables === m.userId}
                  onClick={() => remove.mutate(m.userId)}
                >
                  Remove
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <FormError message={remove.error instanceof ApiError ? remove.error.message : null} />
      {canManage && <AddMember project={project} />}
    </Card>
  );
}
