import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deliverableListSchema,
  deliverableSchema,
  taskSchema,
  type Deliverable,
  type DeliverableVersion,
  type ReviewDecision,
  type Task,
} from '@whiteboard/core';
import { Button, Card, Spinner, cn } from '@whiteboard/ui';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { useAuth } from '../../auth/AuthProvider';
import { FormError } from '../../components/AuthShell';
import { FilePreview } from '../../components/FilePreview';
import { api, errorText } from '../../lib/api';
import { formatDateTime } from '../projects/format';
import { tasksKey } from '../projects/tasks/queries';
import { canManageProject, useProject } from '../projects/useProject';

/**
 * Where a manager decides on a task's work: each version waiting for review, with its file, the
 * artist's note and a summary box. Approve, or ask for changes (the summary is required then).
 */
export function ReviewPage() {
  const { taskId = '' } = useParams();
  const task = useQuery({
    queryKey: ['review-task', taskId],
    queryFn: () => api(`/tasks/${taskId}`, { schema: taskSchema }),
  });
  if (task.isError) return <p className="text-sm text-danger">This task could not be opened.</p>;
  if (!task.data) return <Spinner />;
  return <ReviewTask task={task.data} />;
}

function ReviewTask({ task }: { task: Task }) {
  const { user } = useAuth();
  const project = useProject(task.projectId);
  const list = useQuery({
    queryKey: ['deliverables', task.id],
    queryFn: () => api(`/tasks/${task.id}/deliverables`, { schema: deliverableListSchema }),
  });
  if (!project.data)
    return project.isError ? <FormError message="Could not load the project." /> : <Spinner />;

  const pending = (list.data ?? []).flatMap((d) =>
    d.versions.filter((v) => v.state === 'pending').map((version) => ({ deliverable: d, version })),
  );
  const canReview = canManageProject(user, project.data);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <Link to="/review-queue" className="text-sm text-accent underline">
        Back to the review queue
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{task.title}</h1>
        <p className="text-sm text-muted">{project.data.name}</p>
      </div>
      {list.isPending && <Spinner />}
      {canReview && list.data && pending.length === 0 && (
        <p className="text-sm text-muted">Nothing is waiting for review on this task.</p>
      )}
      {!canReview && <p className="text-sm text-muted">Only a project manager can review this.</p>}
      {canReview &&
        pending.map(({ deliverable, version }) => (
          <ReviewCard key={version.id} task={task} deliverable={deliverable} version={version} />
        ))}
    </div>
  );
}

function ReviewCard({
  task,
  deliverable,
  version,
}: {
  task: Task;
  deliverable: Deliverable;
  version: DeliverableVersion;
}) {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState('');
  const decide = useMutation({
    mutationFn: (decision: ReviewDecision) =>
      api(`/versions/${version.id}/reviews`, {
        method: 'POST',
        body: { decision, summary },
        schema: deliverableSchema,
      }),
    onSuccess: () => {
      // The task moves, so the queue, the board and the task's own list all change.
      void queryClient.invalidateQueries({ queryKey: ['deliverables', task.id] });
      void queryClient.invalidateQueries({ queryKey: ['review-task', task.id] });
      void queryClient.invalidateQueries({ queryKey: tasksKey(task.projectId) });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const needsSummary = summary.trim() === '';

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="text-sm">
          <p className="font-medium">
            {deliverable.name} v{version.number}
          </p>
          <p className="text-muted">
            {version.submittedBy}, {formatDateTime(version.submittedAt)}
          </p>
          {version.note && <p className="mt-1">{version.note}</p>}
        </div>
        <FilePreview fileId={version.fileId} name={version.name} mimeType={version.mimeType} />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Summary for the artist</span>
          <textarea
            value={summary}
            maxLength={2000}
            rows={3}
            onChange={(e) => setSummary(e.target.value)}
            className={cn(
              'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-text',
              'placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent',
            )}
          />
        </label>
        <FormError message={errorText(decide.error)} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            disabled={needsSummary || decide.isPending}
            onClick={() => decide.mutate('changes')}
          >
            Request changes
          </Button>
          <Button loading={decide.isPending} onClick={() => decide.mutate('approve')}>
            Approve
          </Button>
        </div>
      </div>
    </Card>
  );
}
