import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Deliverable, DeliverableVersion, SessionUser } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { mockHost, OWNER, renderApp } from '../../test/render';
import { server } from '../../test/setup';

const MIA: SessionUser = { ...OWNER, id: 'u2', email: 'mia@studio.test', name: 'Mia' };

const version = (over: Partial<DeliverableVersion>): DeliverableVersion => ({
  id: 'v1',
  number: 1,
  fileId: 'f1',
  name: 'poster.png',
  mimeType: 'image/png',
  size: 100,
  note: null,
  state: 'changes',
  submittedBy: 'Fred',
  submittedAt: 1,
  review: null,
  ...over,
});

const DELIVERABLE: Deliverable = {
  id: 'd1',
  name: 'Poster',
  versions: [version({}), version({ id: 'v2', number: 2, fileId: 'f2', name: 'poster-v2.png' })],
};

function mockCompare() {
  server.use(
    http.get('*/tasks/t1/deliverables', () => HttpResponse.json([DELIVERABLE])),
    http.get('*/versions/compare', ({ request }) => {
      const a = new URL(request.url).searchParams.get('a');
      const picked = DELIVERABLE.versions.find((v) => v.id === a) ?? DELIVERABLE.versions[0]!;
      const other = DELIVERABLE.versions.find((v) => v.id !== picked.id)!;
      return HttpResponse.json({ deliverable: 'Poster', a: picked, b: other });
    }),
    http.post('*/files/:id/link', ({ params }) =>
      HttpResponse.json({ url: `/files/${params.id}/stream?t=x`, expiresAt: Date.now() + 60_000 }),
    ),
  );
}

describe('Compare page', () => {
  it('shows the two versions side by side, with one zoom for both', async () => {
    mockHost({}, MIA);
    mockCompare();
    renderApp('/compare/t1/d1', 'tok');

    const panels = await screen.findAllByRole('region', { name: /Version/ });
    expect(panels).toHaveLength(2);
    expect(panels[0]).toHaveTextContent('v1 · poster.png');
    expect(panels[1]).toHaveTextContent('v2 · poster-v2.png');
    expect(screen.getByText('100%')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    for (const img of screen.getAllByRole('img')) {
      expect(img).toHaveStyle({ width: '125%' });
    }
  });

  it('moves the other panel when one scrolls', async () => {
    mockHost({}, MIA);
    mockCompare();
    renderApp('/compare/t1/d1', 'tok');

    const [left, right] = await screen.findAllByRole('region', { name: /Version/ });
    // The scroll box is the element right under each panel's title.
    const boxes = [left, right].map((p) => p!.querySelector('div.overflow-auto') as HTMLElement);
    for (const box of boxes) {
      Object.defineProperty(box, 'scrollHeight', { configurable: true, value: 1000 });
      Object.defineProperty(box, 'clientHeight', { configurable: true, value: 100 });
      Object.defineProperty(box, 'scrollWidth', { configurable: true, value: 100 });
      Object.defineProperty(box, 'clientWidth', { configurable: true, value: 100 });
    }

    boxes[0]!.scrollTop = 450; // half way down the left panel
    fireEvent.scroll(boxes[0]!);
    await waitFor(() => expect(boxes[1]!.scrollTop).toBe(450));
  });

  it('asks for a second version when there is only one', async () => {
    mockHost({}, MIA);
    server.use(
      http.get('*/tasks/t1/deliverables', () =>
        HttpResponse.json([{ ...DELIVERABLE, versions: [DELIVERABLE.versions[0]] }]),
      ),
    );
    renderApp('/compare/t1/d1', 'tok');

    expect(await screen.findByText('Send a second version to compare Poster.')).toBeInTheDocument();
  });
});
