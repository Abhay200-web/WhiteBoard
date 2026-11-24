import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionUser } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockHost, OWNER, renderApp } from '../test/render';
import { server } from '../test/setup';

const MIA: SessionUser = { ...OWNER, id: 'u2', email: 'mia@studio.test', name: 'Mia' };

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
        name: 'poster.png',
        mimeType: 'image/png',
        size: 2048,
        note: null,
        state: 'pending',
        submittedBy: 'Fred',
        submittedAt: 1,
        review: null,
      },
    ],
  },
];

const PIN = {
  id: 'p1',
  versionId: 'v1',
  number: 1,
  page: 1,
  x: 0.25,
  y: 0.25,
  state: 'open',
  createdBy: 'u2',
  createdByName: 'Mia',
  createdAt: 1,
};

function mockReview() {
  server.use(
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
        myRole: 'manager',
        brief: null,
        instructions: null,
        members: [],
      }),
    ),
    http.get('*/tasks/t1', () => HttpResponse.json(TASK)),
    http.get('*/tasks/t1/deliverables', () => HttpResponse.json(DELIVERABLES)),
    http.post('*/files/f1/link', () =>
      HttpResponse.json({ url: '/files/f1/stream?token=x', expiresAt: 9_999_999_999 }),
    ),
  );
}

afterEach(() => vi.restoreAllMocks());

describe('Pinned preview', () => {
  it('drops a numbered pin where the image is clicked and opens its thread', async () => {
    let sent: unknown = null;
    mockHost({}, MIA);
    mockReview();
    server.use(
      http.get('*/versions/v1/pins', () => HttpResponse.json(sent ? [PIN] : [])),
      http.post('*/versions/v1/pins', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(PIN, { status: 201 });
      }),
      http.get('*/pins/p1/comments', () => HttpResponse.json([])),
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
    } as DOMRect);
    renderApp('/review/t1', 'tok');

    const image = await screen.findByRole('img', { name: 'poster.png' });
    // The pin layer is drawn over the image, as the last child of the image's wrapper.
    fireEvent.click(image.parentElement!.lastElementChild!, { clientX: 50, clientY: 25 });

    await waitFor(() => expect(sent).toEqual({ page: 1, x: 0.25, y: 0.25 }));
    expect(await screen.findByRole('button', { name: 'Pin 1, open' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Pin 1 thread')).toBeInTheDocument();
  });

  it('posts a reply to the open pin and shows it in the thread', async () => {
    let reply: unknown = null;
    mockHost({}, MIA);
    mockReview();
    server.use(
      http.get('*/versions/v1/pins', () => HttpResponse.json([PIN])),
      http.get('*/pins/p1/comments', () =>
        HttpResponse.json(
          reply
            ? [
                {
                  id: 'c1',
                  pinId: 'p1',
                  authorId: 'u2',
                  authorName: 'Mia',
                  body: 'Move the logo left',
                  createdAt: 2,
                },
              ]
            : [],
        ),
      ),
      http.post('*/pins/p1/comments', async ({ request }) => {
        reply = await request.json();
        return HttpResponse.json([]);
      }),
    );
    renderApp('/review/t1', 'tok');

    await userEvent.click(await screen.findByRole('button', { name: 'Pin 1, open' }));
    await userEvent.type(await screen.findByLabelText('Reply'), 'Move the logo left');
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));

    await waitFor(() => expect(reply).toEqual({ body: 'Move the logo left' }));
    expect(await screen.findByText('Move the logo left', { selector: 'p' })).toBeInTheDocument();
  });
});
