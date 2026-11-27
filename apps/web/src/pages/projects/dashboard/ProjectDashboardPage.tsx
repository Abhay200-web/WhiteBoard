import { useQuery } from '@tanstack/react-query';
import { projectReportSchema, type ProjectReport } from '@whiteboard/core';
import { Button, Card, Spinner } from '@whiteboard/ui';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { api, ApiError, downloadFile } from '../../../lib/api';
import { useProject } from '../useProject';

const useReport = (projectId: string) =>
  useQuery({
    queryKey: ['report', projectId],
    queryFn: () => api(`/projects/${projectId}/report`, { schema: projectReportSchema }),
  });

/** Saves the project as Markdown or PDF. */
function ExportButtons({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (format: 'markdown' | 'pdf') => {
    setBusy(true);
    setError(null);
    try {
      await downloadFile(`/projects/${projectId}/export?format=${format}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not export the project.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" disabled={busy} onClick={() => save('markdown')}>
        Export Markdown
      </Button>
      <Button variant="secondary" disabled={busy} onClick={() => save('pdf')}>
        Export PDF
      </Button>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </Card>
  );
}

/** Progress, status counts, workload and review turnaround for one project. */
function Dashboard({ report }: { report: ProjectReport }) {
  const { progress, byStatus, workload, unassigned, reviews } = report;
  const percentDone = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  const largest = Math.max(1, ...byStatus.map((s) => s.count));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Open tasks" value={progress.open} note={`${progress.done} done`} />
        <Tile label="Overdue" value={progress.overdue} />
        <Tile label="Due in the next 7 days" value={progress.dueSoon} />
        <Tile label="Waiting for review" value={reviews.waiting} />
      </div>

      <Card>
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Progress</h2>
          <span className="text-sm text-muted">{percentDone}% done</span>
        </div>
        <div
          role="progressbar"
          aria-label="Tasks done"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentDone}
          className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
        >
          <div className="h-full bg-accent" style={{ width: `${percentDone}%` }} />
        </div>
      </Card>

      <Card>
        <h2 className="font-semibold">Tasks by status</h2>
        {byStatus.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No statuses yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {byStatus.map((s) => (
              <li key={s.statusId} className="grid grid-cols-[9rem_1fr_2rem] items-center gap-3">
                <span className="truncate">{s.name}</span>
                <span className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full bg-accent"
                    style={{ width: `${(s.count / largest) * 100}%` }}
                  />
                </span>
                <span className="text-right tabular-nums">{s.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">Workload</h2>
        {workload.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nobody has open tasks.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 font-medium">Person</th>
                <th className="py-1 text-right font-medium">Open</th>
                <th className="py-1 text-right font-medium">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {workload.map((w) => (
                <tr key={w.userId} className="border-t border-line">
                  <td className="py-2">{w.name}</td>
                  <td className="py-2 text-right tabular-nums">{w.open}</td>
                  <td className="py-2 text-right tabular-nums">{w.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {unassigned > 0 && (
          <p className="mt-3 text-sm text-muted">
            {unassigned} open {unassigned === 1 ? 'task has' : 'tasks have'} no one assigned.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold">Review turnaround</h2>
        <ul className="mt-2 space-y-1 text-sm">
          <li>Approved: {reviews.approved}</li>
          <li>Changes requested: {reviews.changesRequested}</li>
          <li>
            Average time from submission to decision:{' '}
            {reviews.averageHours === null ? 'no decisions yet' : `${reviews.averageHours} hours`}
          </li>
        </ul>
      </Card>
    </>
  );
}

export function ProjectDashboardPage() {
  const { id = '' } = useParams();
  const project = useProject(id);
  const report = useReport(id);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex gap-4 text-sm">
        <Link to={`/projects/${id}`} className="text-accent underline">
          Back to project
        </Link>
      </div>
      <h1 className="text-xl font-semibold">
        Dashboard{project.data && <span className="text-muted"> · {project.data.name}</span>}
      </h1>
      {id && <ExportButtons projectId={id} />}

      {report.isPending && <Spinner />}
      {report.isError && <p className="text-sm text-danger">Could not load the dashboard.</p>}
      {report.data && <Dashboard report={report.data} />}
    </div>
  );
}
