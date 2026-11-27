import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectReport } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { mockHost, OWNER, renderApp } from '../../../test/render';
import { server } from '../../../test/setup';

const REPORT: ProjectReport = {
  generatedAt: 1,
  progress: { total: 5, done: 2, open: 3, overdue: 1, dueSoon: 2 },
  byStatus: [
    { statusId: 's1', name: 'To do', kind: 'todo', count: 2 },
    { statusId: 's2', name: 'Done', kind: 'done', count: 2 },
  ],
  workload: [{ userId: 'u2', name: 'Mia', open: 2, overdue: 1 }],
  unassigned: 1,
  reviews: { waiting: 1, approved: 3, changesRequested: 1, averageHours: 4.5 },
};

const PROJECT = {
  id: 'p1',
  name: 'Logo for Client X',
  clientName: null,
  status: 'active',
  startDate: null,
  deadline: null,
  budget: null,
  color: null,
  createdBy: 'u1',
  createdAt: 1,
  memberCount: 1,
  myRole: 'manager',
  brief: null,
  instructions: null,
  members: [],
};

describe('project dashboard', () => {
  it('shows progress, overdue work, workload and review turnaround', async () => {
    mockHost({}, OWNER);
    server.use(
      http.get('*/projects/p1', () => HttpResponse.json(PROJECT)),
      http.get('*/projects/p1/report', () => HttpResponse.json(REPORT)),
    );
    renderApp('/projects/p1/dashboard', 'tok');

    // "Overdue" is also a workload column heading, so pick the tile's label.
    const overdue = await screen.findByText('Overdue', { selector: 'p' });
    expect(overdue.parentElement).toHaveTextContent('1');
    expect(screen.getByText('Waiting for review').parentElement).toHaveTextContent('1');
    expect(screen.getByRole('progressbar', { name: 'Tasks done' })).toHaveAttribute(
      'aria-valuenow',
      '40',
    );
    const workload = screen.getByRole('table');
    expect(within(workload).getByText('Mia')).toBeInTheDocument();
    expect(screen.getByText('1 open task has no one assigned.')).toBeInTheDocument();
    expect(
      screen.getByText(/Average time from submission to decision: 4.5 hours/),
    ).toBeInTheDocument();
  });

  it('downloads the project as Markdown with the Host’s file name', async () => {
    mockHost({}, OWNER);
    let query = '';
    server.use(
      http.get('*/projects/p1', () => HttpResponse.json(PROJECT)),
      http.get('*/projects/p1/report', () => HttpResponse.json(REPORT)),
      http.get('*/projects/p1/export', ({ request }) => {
        query = new URL(request.url).search;
        return new HttpResponse('# Logo for Client X\n', {
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
            'content-disposition': 'attachment; filename="Logo for Client X - export.md"',
          },
        });
      }),
    );
    // jsdom has no object URLs, so the download helper gets stand-ins.
    const createObjectURL = vi.fn(() => 'blob:export');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const clicked: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });

    renderApp('/projects/p1/dashboard', 'tok');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Export Markdown' }));

    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(query).toBe('?format=markdown');
    expect(clicked[0]!.download).toBe('Logo for Client X - export.md');
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');

    click.mockRestore();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });
});
