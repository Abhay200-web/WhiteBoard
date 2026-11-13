import { useQuery } from '@tanstack/react-query';
import { projectListSchema } from '@whiteboard/core';
import { Card, Spinner } from '@whiteboard/ui';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthProvider';
import { FormError } from '../../components/AuthShell';
import { api } from '../../lib/api';
import { formatDate, ROLE_LABEL, STATUS_LABEL } from './format';

export function ProjectsPage() {
  const { user } = useAuth();
  const canCreate = user?.role !== 'guest';
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api('/projects', { schema: projectListSchema }),
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Projects</h1>
        {canCreate && (
          <Link
            to="/projects/new"
            className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover"
          >
            New project
          </Link>
        )}
      </div>

      <div className="mt-6">
        {projects.isPending && <Spinner />}
        {projects.isError && <FormError message="Could not load your projects." />}
        {projects.data && projects.data.length === 0 && (
          <p className="text-sm text-muted">
            {canCreate
              ? 'No projects yet. Create the first one.'
              : 'You are not on any project yet. A manager will add you.'}
          </p>
        )}
        {projects.data && projects.data.length > 0 && (
          <ul aria-label="Projects" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.data.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`} className="block focus-visible:outline-2">
                  <Card className="h-full p-4 transition-shadow hover:shadow-md">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-semibold">{p.name}</h2>
                      <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs">
                        {STATUS_LABEL[p.status]}
                      </span>
                    </div>
                    {p.clientName && <p className="mt-1 text-sm text-muted">{p.clientName}</p>}
                    <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <div>Deadline: {formatDate(p.deadline)}</div>
                      <div>
                        {p.memberCount} {p.memberCount === 1 ? 'person' : 'people'}
                      </div>
                      {p.myRole && <div>You: {ROLE_LABEL[p.myRole]}</div>}
                    </dl>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
