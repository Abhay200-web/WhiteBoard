import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Person, ProjectDetail, SessionUser } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockHost, OWNER, renderApp } from '../../test/render';
import { server } from '../../test/setup';

const MEMBER: SessionUser = {
  ...OWNER,
  id: 'u2',
  email: 'mia@studio.test',
  name: 'Mia',
  role: 'member',
};
const GUEST: SessionUser = {
  ...OWNER,
  id: 'u3',
  email: 'fred@free.test',
  name: 'Fred',
  role: 'guest',
};

const DEADLINE = new Date('2027-03-01T12:00:00').getTime();

const summary = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Logo for Client X',
  clientName: 'Client X',
  status: 'draft',
  startDate: null,
  deadline: DEADLINE,
  budget: null,
  color: null,
  createdBy: 'u2',
  createdAt: 1,
  memberCount: 1,
  myRole: 'manager',
  ...over,
});

const detail = (over: Record<string, unknown> = {}): ProjectDetail =>
  ({
    ...summary(),
    brief: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Make it bold' }] }],
    },
    instructions: null,
    members: [{ userId: 'u2', name: 'Mia', email: 'mia@studio.test', role: 'manager' }],
    ...over,
  }) as ProjectDetail;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
});

describe('projects list', () => {
  it('shows my projects and a New project button for staff', async () => {
    mockHost({}, MEMBER);
    server.use(
      http.get('*/projects', () =>
        HttpResponse.json([
          summary(),
          summary({ id: 'p2', name: 'Packaging', myRole: 'artist', memberCount: 3 }),
        ]),
      ),
    );
    renderApp('/projects', 'tok');
    const list = await screen.findByRole('list', { name: 'Projects' });
    expect(within(list).getByText('Logo for Client X')).toBeInTheDocument();
    expect(within(list).getByText('3 people')).toBeInTheDocument();
    expect(within(list).getByText('You: Artist')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New project' })).toHaveAttribute(
      'href',
      '/projects/new',
    );
  });

  it('shows an empty message and no create button for freelancers', async () => {
    mockHost({}, GUEST);
    server.use(http.get('*/projects', () => HttpResponse.json([])));
    renderApp('/projects', 'tok');
    expect(await screen.findByText(/You are not on any project yet/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New project' })).not.toBeInTheDocument();
  });

  it('sends freelancers away from the create page', async () => {
    mockHost({}, GUEST);
    server.use(http.get('*/projects', () => HttpResponse.json([])));
    const { router } = renderApp('/projects/new', 'tok');
    await screen.findByText(/You are not on any project yet/);
    expect(router.state.location.pathname).toBe('/projects');
  });
});

describe('create project', () => {
  it('creates a project with a brief and dates, attaches uploaded files and opens it', async () => {
    mockHost({}, MEMBER);
    let created: Record<string, unknown> | null = null;
    let attached: unknown = null;
    server.use(
      // `*` also matches slashes, so the more specific URL must be registered first.
      http.post('*/projects/p1/files', async ({ request }) => {
        attached = await request.json();
        return HttpResponse.json([], { status: 201 });
      }),
      http.post('*/files', () =>
        HttpResponse.json(
          {
            id: 'f1',
            name: 'ref.png',
            mimeType: 'image/png',
            size: 2048,
            sha256: 'a'.repeat(64),
            hasThumbnail: false,
            uploadedBy: 'u2',
            createdAt: 1,
          },
          { status: 201 },
        ),
      ),
      http.post('*/projects', async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(detail({ status: 'draft' }), { status: 201 });
      }),
      http.get('*/projects/p1', () => HttpResponse.json(detail())),
      http.get('*/projects/p1/files', () => HttpResponse.json([])),
      http.get('*/people', () => HttpResponse.json([])),
      http.get('*/projects', () => HttpResponse.json([])),
    );
    const user = userEvent.setup();
    const { router } = renderApp('/projects/new', 'tok');

    await user.type(await screen.findByLabelText('Project name'), 'Logo for Client X');
    await user.type(screen.getByLabelText('Client (optional)'), 'Client X');
    await user.type(screen.getByLabelText('Deadline'), '2027-03-01');
    await user.click(screen.getByRole('textbox', { name: 'Brief' }));
    await user.keyboard('Make it bold');
    await user.upload(
      screen.getByLabelText(/Choose files/),
      new File(['x'.repeat(2048)], 'ref.png', { type: 'image/png' }),
    );
    expect(await screen.findByRole('list', { name: 'Files to attach' })).toHaveTextContent(
      'ref.png',
    );

    await user.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/p1'));

    expect(created).toMatchObject({
      name: 'Logo for Client X',
      clientName: 'Client X',
      instructions: null,
      deadline: new Date('2027-03-01T23:59:59').getTime(),
    });
    expect(JSON.stringify((created as unknown as { brief: unknown }).brief)).toContain(
      'Make it bold',
    );
    expect(attached).toEqual({ fileId: 'f1', kind: 'reference' });
    expect(await screen.findByRole('heading', { name: 'Logo for Client X' })).toBeInTheDocument();
  });

  it('needs a name and valid dates before calling the Host', async () => {
    mockHost({}, MEMBER);
    const user = userEvent.setup();
    renderApp('/projects/new', 'tok');
    await user.click(await screen.findByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Project name'), 'X');
    await user.type(screen.getByLabelText('Start date'), '2027-05-01');
    await user.type(screen.getByLabelText('Deadline'), '2027-04-01');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(
      await screen.findByText('The deadline cannot be before the start date'),
    ).toBeInTheDocument();
  });

  it('shows the Host error when creating fails', async () => {
    mockHost({}, MEMBER);
    server.use(
      http.post('*/projects', () =>
        HttpResponse.json(
          { error: 'forbidden', message: 'You do not have access to this' },
          { status: 403 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp('/projects/new', 'tok');
    await user.type(await screen.findByLabelText('Project name'), 'X');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('You do not have access to this')).toBeInTheDocument();
  });
});

describe('project overview', () => {
  const PEOPLE: Person[] = [
    { id: 'u2', name: 'Mia', email: 'mia@studio.test', role: 'member' },
    { id: 'u3', name: 'Fred', email: 'fred@free.test', role: 'guest' },
  ];

  function mockProject(project: ProjectDetail, files: unknown[] = []) {
    server.use(
      http.get('*/projects/p1', () => HttpResponse.json(project)),
      http.get('*/projects/p1/files', () => HttpResponse.json(files)),
      http.get('*/people', () => HttpResponse.json(PEOPLE)),
    );
  }

  it('shows details, the brief, people and status controls to the manager', async () => {
    mockHost({}, MEMBER);
    mockProject(detail());
    renderApp('/projects/p1', 'tok');
    expect(await screen.findByRole('heading', { name: 'Logo for Client X' })).toBeInTheDocument();
    expect(screen.getByLabelText('Project status')).toHaveTextContent('Draft');
    expect(screen.getByText('Make it bold')).toBeInTheDocument();
    expect(
      screen.getByText(
        new Date(DEADLINE).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        }),
      ),
    ).toBeInTheDocument();
    const members = screen.getByRole('list', { name: 'Project members' });
    expect(within(members).getByText('Mia')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as active' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark as delivered' })).not.toBeInTheDocument();
  });

  it('changes the status', async () => {
    mockHost({}, MEMBER);
    let current = detail();
    server.use(
      http.get('*/projects/p1', () => HttpResponse.json(current)),
      http.get('*/projects/p1/files', () => HttpResponse.json([])),
      http.get('*/people', () => HttpResponse.json([])),
      http.get('*/projects', () => HttpResponse.json([])),
      http.post('*/projects/p1/status', async ({ request }) => {
        const { status } = (await request.json()) as { status: string };
        current = detail({ status });
        return HttpResponse.json(current);
      }),
    );
    const user = userEvent.setup();
    renderApp('/projects/p1', 'tok');
    await user.click(await screen.findByRole('button', { name: 'Mark as active' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Project status')).toHaveTextContent('Active'),
    );
    expect(screen.getByRole('button', { name: 'Send to review' })).toBeInTheDocument();
  });

  it('adds a person (freelancers can only be artists) and removes one', async () => {
    mockHost({}, MEMBER);
    let current = detail();
    let added: unknown = null;
    server.use(
      http.get('*/projects/p1', () => HttpResponse.json(current)),
      http.get('*/projects/p1/files', () => HttpResponse.json([])),
      http.get('*/people', () => HttpResponse.json(PEOPLE)),
      http.get('*/projects', () => HttpResponse.json([])),
      http.post('*/projects/p1/members', async ({ request }) => {
        added = await request.json();
        current = detail({
          members: [
            ...current.members,
            { userId: 'u3', name: 'Fred', email: 'fred@free.test', role: 'artist' },
          ],
        });
        return HttpResponse.json(current, { status: 201 });
      }),
      http.delete('*/projects/p1/members/u3', () => {
        current = detail();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/projects/p1', 'tok');
    await screen.findByRole('option', { name: /Fred/ });
    await user.selectOptions(screen.getByLabelText('Add a person'), 'u3');
    expect(screen.getByLabelText('Project role')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add to project' }));
    expect(await screen.findByRole('button', { name: 'Remove Fred' })).toBeInTheDocument();
    expect(added).toEqual({ userId: 'u3', role: 'artist' });

    await user.click(screen.getByRole('button', { name: 'Remove Fred' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove Fred' })).not.toBeInTheDocument(),
    );
  });

  it('shows an artist the project without any management controls', async () => {
    mockHost({}, GUEST);
    mockProject(
      detail({
        myRole: 'artist',
        members: [
          { userId: 'u2', name: 'Mia', email: 'mia@studio.test', role: 'manager' },
          { userId: 'u3', name: 'Fred', email: 'fred@free.test', role: 'artist' },
        ],
      }),
      [
        {
          fileId: 'f1',
          kind: 'reference',
          addedBy: 'u2',
          addedAt: 1,
          name: 'brief.pdf',
          mimeType: 'application/pdf',
          size: 4096,
          hasThumbnail: false,
        },
      ],
    );
    renderApp('/projects/p1', 'tok');
    expect(await screen.findByRole('heading', { name: 'Logo for Client X' })).toBeInTheDocument();
    expect(screen.getByText('Your role').nextSibling).toHaveTextContent('Artist');
    expect(screen.queryByRole('button', { name: 'Mark as active' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add a person')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Choose files/)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'brief.pdf' })).toBeInTheDocument();
  });

  it('opens a file preview and lets the manager remove the file', async () => {
    mockHost({}, MEMBER);
    let files = [
      {
        fileId: 'f1',
        kind: 'reference',
        addedBy: 'u2',
        addedAt: 1,
        name: 'ref.png',
        mimeType: 'image/png',
        size: 4096,
        hasThumbnail: false,
      },
    ];
    server.use(
      http.get('*/projects/p1', () => HttpResponse.json(detail())),
      http.get('*/projects/p1/files', () => HttpResponse.json(files)),
      http.get('*/people', () => HttpResponse.json([])),
      http.get(
        '*/files/f1/content',
        () => new HttpResponse('img', { headers: { 'content-type': 'image/png' } }),
      ),
      http.delete('*/projects/p1/files/f1', () => {
        files = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/projects/p1', 'tok');
    await user.click(await screen.findByRole('button', { name: 'ref.png' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('img', { name: 'ref.png' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: 'Remove file ref.png' }));
    expect(await screen.findByText('No files yet.')).toBeInTheDocument();
  });

  it('explains when the project is not found', async () => {
    mockHost({}, MEMBER);
    server.use(
      http.get('*/projects/nope', () =>
        HttpResponse.json({ error: 'not_found', message: 'Project not found' }, { status: 404 }),
      ),
    );
    renderApp('/projects/nope', 'tok');
    expect(await screen.findByRole('heading', { name: 'Project not found' })).toBeInTheDocument();
  });
});
