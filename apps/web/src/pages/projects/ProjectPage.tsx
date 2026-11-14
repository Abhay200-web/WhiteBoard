import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PROJECT_STATUS_FLOW,
  projectDetailSchema,
  type ProjectDetail,
  type ProjectStatus,
} from '@whiteboard/core';
import { isRichTextEmpty, RichTextView } from '@whiteboard/editor';
import { Button, Card, Spinner } from '@whiteboard/ui';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { useAuth } from '../../auth/AuthProvider';
import { FormError } from '../../components/AuthShell';
import { api, ApiError } from '../../lib/api';
import { EditProjectDialog } from './EditProjectDialog';
import { formatDate, ROLE_LABEL, STATUS_ACTION, STATUS_LABEL } from './format';
import { ProjectFilesCard } from './ProjectFilesCard';
import { ProjectMembersCard } from './ProjectMembersCard';
import { TaskList } from './tasks/TaskList';
import { canManageProject, useProject } from './useProject';

function StatusControls({ project }: { project: ProjectDetail }) {
  const queryClient = useQueryClient();
  const move = useMutation({
    mutationFn: (status: ProjectStatus) =>
      api(`/projects/${project.id}/status`, {
        method: 'POST',
        body: { status },
        schema: projectDetailSchema,
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(['project', project.id], updated);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {PROJECT_STATUS_FLOW[project.status].map((next) => (
          <Button
            key={next}
            variant={next === 'archived' ? 'ghost' : 'secondary'}
            loading={move.isPending && move.variables === next}
            onClick={() => move.mutate(next)}
          >
            {STATUS_ACTION[next]}
          </Button>
        ))}
      </div>
      <FormError message={move.error instanceof ApiError ? move.error.message : null} />
    </div>
  );
}

/** Project overview: details, brief, tasks, people and files. */
export function ProjectPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const project = useProject(id);

  if (project.isPending) return <Spinner />;
  if (project.isError || !project.data) {
    const notFound = project.error instanceof ApiError && project.error.status === 404;
    return (
      <div>
        <h1 className="text-xl font-semibold">
          {notFound ? 'Project not found' : 'Something went wrong'}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {notFound
            ? 'It may not exist, or you may not be on it.'
            : 'Could not load this project. Try again in a moment.'}
        </p>
        <Link to="/projects" className="mt-3 inline-block text-sm text-accent underline">
          Back to projects
        </Link>
      </div>
    );
  }

  const p = project.data;
  const canManage = canManageProject(user, p);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link to="/projects" className="text-sm text-accent underline">
          Back to projects
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{p.name}</h1>
            {p.clientName && <p className="text-sm text-muted">{p.clientName}</p>}
          </div>
          <span className="rounded-full bg-surface-2 px-3 py-1 text-sm" aria-label="Project status">
            {STATUS_LABEL[p.status]}
          </span>
        </div>
        {canManage && (
          <div className="mt-3 flex flex-wrap items-start justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit project
            </Button>
            <StatusControls project={p} />
          </div>
        )}
        {editing && <EditProjectDialog project={p} onClose={() => setEditing(false)} />}
      </div>

      <Card>
        <h2 className="font-semibold">Details</h2>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Start date</dt>
            <dd>{formatDate(p.startDate)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Deadline</dt>
            <dd>{formatDate(p.deadline)}</dd>
          </div>
          {p.budget !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Budget</dt>
              <dd>{p.budget.toLocaleString()}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Your role</dt>
            <dd>{p.myRole ? ROLE_LABEL[p.myRole] : 'Admin'}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <h2 className="font-semibold">Brief</h2>
        {isRichTextEmpty(p.brief) || !p.brief ? (
          <p className="mt-2 text-sm text-muted">No brief written yet.</p>
        ) : (
          <RichTextView value={p.brief} />
        )}
      </Card>

      {p.instructions && !isRichTextEmpty(p.instructions) && (
        <Card>
          <h2 className="font-semibold">Instructions</h2>
          <RichTextView value={p.instructions} />
        </Card>
      )}

      <TaskList project={p} canManage={canManage} />
      <ProjectMembersCard project={p} canManage={canManage} />
      <ProjectFilesCard projectId={p.id} canManage={canManage} />
    </div>
  );
}
