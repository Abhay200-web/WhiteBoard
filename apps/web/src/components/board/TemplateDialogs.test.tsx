import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardTemplate, Card } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Providers } from '../../App';
import { setToken } from '../../lib/api';
import { mockHost, OWNER } from '../../test/render';
import { server } from '../../test/setup';
import { NewBoardDialog, SaveTemplateDialog } from './TemplateDialogs';

function renderSignedIn(ui: ReactNode, user = { ...OWNER, id: 'u2', role: 'member' as const }) {
  mockHost({}, user);
  setToken('tok');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<Providers client={client}>{ui}</Providers>);
}

const template = (over: Partial<BoardTemplate>): BoardTemplate => ({
  id: 'builtin:moodboard',
  name: 'Moodboard',
  builtIn: true,
  cardCount: 4,
  createdBy: null,
  createdByName: null,
  ...over,
});

describe('new board dialog', () => {
  it('starts a board with a template, and deletes only my own saved templates', async () => {
    let templates = [
      template({}),
      template({ id: 't1', name: 'Pitch', builtIn: false, createdBy: 'u2', createdByName: 'Mia' }),
      template({ id: 't2', name: 'Theirs', builtIn: false, createdBy: 'u9', createdByName: 'Bo' }),
    ];
    let created: unknown = null;
    server.use(
      http.get('*/board-templates', () => HttpResponse.json(templates)),
      http.delete('*/board-templates/t1', () => {
        templates = templates.filter((t) => t.id !== 't1');
        return new HttpResponse(null, { status: 204 });
      }),
      http.post('*/boards/b1/boards', async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderSignedIn(<NewBoardDialog boardId="b1" at={{ x: 10, y: 20 }} onClose={onClose} />);

    const list = await screen.findByRole('list', { name: 'Templates' });
    expect(within(list).getByRole('radio', { name: /Blank board/ })).toBeChecked();
    expect(await within(list).findByText('4 cards, saved by Mia')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete template Pitch' })).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: 'Delete template Theirs' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete template Moodboard' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete template Pitch' }));
    await waitFor(() => expect(within(list).queryByText('Pitch')).not.toBeInTheDocument());

    await user.click(within(list).getByRole('radio', { name: /Moodboard/ }));
    const name = screen.getByLabelText('Board name');
    await user.clear(name);
    await user.type(name, 'Looks');
    await user.click(screen.getByRole('button', { name: 'Create board' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(created).toEqual({ title: 'Looks', x: 10, y: 20, templateId: 'builtin:moodboard' });
  });
});

describe('save as template dialog', () => {
  const place = { x: 0, y: 0, width: 100, height: 100 };
  const cards: Card[] = [
    { ...place, id: 'a', kind: 'note', text: 'Hello' },
    { ...place, id: 'b', kind: 'column', title: 'Review', statusId: 's1' },
    { ...place, id: 'c', kind: 'image', fileId: 'f1', name: 'a.png' },
    { ...place, id: 'd', kind: 'task', taskId: 't1' },
  ];

  it('keeps notes and columns, says what stays behind, and saves', async () => {
    let sent: { name: string; cards: Record<string, unknown>[] } | null = null;
    server.use(
      http.post('*/board-templates', async ({ request }) => {
        sent = (await request.json()) as typeof sent;
        return HttpResponse.json(
          template({ id: 't1', name: sent!.name, builtIn: false, createdBy: 'u2' }),
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderSignedIn(<SaveTemplateDialog title="Ideas" cards={cards} onClose={() => {}} />);

    expect(screen.getByLabelText('Template name')).toHaveValue('Ideas');
    expect(
      screen.getByText('2 cards will be kept. 2 pictures, files and tasks stay with this project.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save template' }));

    expect(await screen.findByRole('status')).toHaveTextContent('“Ideas” is now offered');
    expect(sent!.cards.map((c) => c.kind)).toEqual(['note', 'column']);
    expect(sent!.cards[1]).not.toHaveProperty('statusId');
  });

  it('cannot save a board with nothing to keep', () => {
    renderSignedIn(<SaveTemplateDialog title="Pics" cards={cards.slice(2)} onClose={() => {}} />);
    expect(screen.getByText(/no notes, columns, lines or links/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();
  });
});
