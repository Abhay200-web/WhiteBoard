import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionUser } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { mockHost, OWNER, renderApp } from '../../test/render';
import { server } from '../../test/setup';

const MIA: SessionUser = { ...OWNER, id: 'u2', email: 'mia@studio.test', name: 'Mia' };
const FRED: SessionUser = {
  ...OWNER,
  id: 'u3',
  email: 'fred@free.test',
  name: 'Fred',
  role: 'guest',
};

const TASK = {
  id: 't1',
  projectId: 'p1',
  statusId: 's-review',
  title: 'Logo concepts',
  description: null,
  priority: 'high',
  startAt: null,
  dueAt: null,
  sortKey: 1000,
  createdBy: 'u2',
  createdAt: 1,
  updatedAt: 1,
  assignees: [{ userId: 'u3', name: 'Fred' }],
  subtaskCounts: { done: 0, total: 0 },
  fileCount: 1,
};

const DELIVERABLES = [
  {
    id: 'd1',
    name: 'Poster',
    versions: [
      {
        id: 'v1',
        number: 1,
        fileId: 'f1',
        name: 'poster.bin',
        mimeType: 'application/octet-stream',
        size: 2048,
        note: 'First draft',
        state: 'pending',
        submittedBy: 'Fred',
        submittedAt: 1,
        review: null,
      },
    ],
  },
];

function mockProject(myRole: 'manager' | 'artist') {
  server.use(
    http.get('*/tasks/t1', () => HttpResponse.json(TASK)),
    http.get('*/projects/p1', () =>
      HttpResponse.json({
        id: 'p1',
        name: 'Logo for Client X',
        clientName: null,
        status: 'active',
        startDate: null,
        deadline: null,
        budget: null,
        color: null,
        createdBy: 'u2',
        createdAt: 1,
        memberCount: 2,
        myRole,
        brief: null,
        instructions: null,
        members: [],
      }),
    ),
    http.get('*/tasks/t1/deliverables', () => HttpResponse.json(DELIVERABLES)),
  );
}

describe('Review page', () => {
  it('shows the pending version, and asks for a summary before changes can be requested', async () => {
    mockHost({}, MIA);
    mockProject('manager');
    renderApp('/review/t1', 'tok');

    expect(await screen.findByRole('heading', { name: 'Logo concepts' })).toBeInTheDocument();
    expect(screen.getByText('Poster v1')).toBeInTheDocument();
    expect(screen.getByText('First draft')).toBeInTheDocument();

    const changes = screen.getByRole('button', { name: 'Request changes' });
    expect(changes).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Summary for the artist'), 'Logo too small');
    expect(changes).toBeEnabled();
  });

  it('sends the decision and the summary to the Host', async () => {
    let sent: unknown = null;
    mockHost({}, MIA);
    mockProject('manager');
    server.use(
      http.post('*/versions/v1/reviews', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(DELIVERABLES, { status: 201 });
      }),
    );
    renderApp('/review/t1', 'tok');

    await userEvent.type(await screen.findByLabelText('Summary for the artist'), 'Nice work');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(sent).toEqual({ decision: 'approve', summary: 'Nice work' }));
  });

  it('tells an artist that only a manager can review', async () => {
    mockHost({}, FRED);
    mockProject('artist');
    renderApp('/review/t1', 'tok');

    expect(await screen.findByText('Only a project manager can review this.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});
