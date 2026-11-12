import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Invite, Member, SessionUser } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { getHostUrl, getToken, setHostUrl } from '../lib/api';
import { normalizeHostAddress } from '../lib/hostAddress';
import { mockHost, OWNER, renderApp } from '../test/render';
import { server } from '../test/setup';

const MIA: Member = {
  id: 'u2',
  email: 'mia@studio.test',
  name: 'Mia',
  role: 'member',
  expiresAt: null,
  mustChangePassword: false,
};
const OWNER_MEMBER: Member = {
  ...MIA,
  id: OWNER.id,
  email: OWNER.email,
  name: 'Owner',
  role: 'owner',
};
const FREE: Member = {
  ...MIA,
  id: 'u3',
  email: 'fred@free.test',
  name: 'Fred',
  role: 'guest',
  expiresAt: new Date('2027-03-01T12:00:00').getTime(),
};

describe('normalizeHostAddress', () => {
  it('adds scheme and the default port, and rejects junk', () => {
    expect(normalizeHostAddress('192.168.1.20')).toBe('http://192.168.1.20:47800');
    expect(normalizeHostAddress(' office-pc:5000 ')).toBe('http://office-pc:5000');
    expect(normalizeHostAddress('http://10.0.0.5/')).toBe('http://10.0.0.5:47800');
    expect(normalizeHostAddress('')).toBeNull();
    expect(normalizeHostAddress('http://')).toBeNull();
  });
});

describe('connect to a Host', () => {
  it('saves a reachable Host and drops the old session', async () => {
    setHostUrl('http://old-host:47800');
    server.use(
      http.get('http://192.168.1.20:47800/host/info', () =>
        HttpResponse.json({ workspaceName: 'Studio', serverVersion: '0.1.0', setupDone: true }),
      ),
    );
    mockHost();
    const user = userEvent.setup();
    renderApp('/connect', 'old-token');
    await user.clear(await screen.findByLabelText('Host address'));
    await user.type(screen.getByLabelText('Host address'), '192.168.1.20');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(getHostUrl()).toBe('http://192.168.1.20:47800');
    expect(getToken()).toBeNull();
  });

  it('explains when nothing answers, and keeps the current Host', async () => {
    setHostUrl('http://old-host:47800');
    server.use(http.get('http://10.9.9.9:47800/host/info', () => HttpResponse.error()));
    const user = userEvent.setup();
    renderApp('/connect');
    await user.clear(await screen.findByLabelText('Host address'));
    await user.type(screen.getByLabelText('Host address'), '10.9.9.9');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not find a whiteboard host/i);
    expect(getHostUrl()).toBe('http://old-host:47800');
  });

  it('rejects an empty address without a network call', async () => {
    const user = userEvent.setup();
    renderApp('/connect');
    await user.clear(await screen.findByLabelText('Host address'));
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter the host address/i);
  });
});

describe('join with an invite code', () => {
  it('prefills the code from the link, creates the account and lands on Home', async () => {
    mockHost({}, MIA as unknown as SessionUser);
    let body: Record<string, string> = {};
    server.use(
      http.post('*/invites/accept', async ({ request }) => {
        body = (await request.json()) as Record<string, string>;
        return HttpResponse.json(
          {
            token: 'tok-mia',
            expiresAt: Date.now() + 1000,
            user: { ...MIA, mustChangePassword: false },
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderApp('/join?code=K7QX-M2PD-9WTA');
    expect(await screen.findByLabelText('Invite code')).toHaveValue('K7QX-M2PD-9WTA');
    await user.type(screen.getByLabelText('Your name'), 'Mia');
    await user.type(screen.getByLabelText('Email'), 'mia@studio.test');
    await user.type(screen.getByLabelText('Password'), 'a-long-new-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-long-new-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(body).toMatchObject({ code: 'K7QX-M2PD-9WTA', email: 'mia@studio.test' });
  });

  it('shows the Host message for a bad code', async () => {
    mockHost();
    server.use(
      http.post('*/invites/accept', () =>
        HttpResponse.json(
          { error: 'invalid_invite', message: 'This invite code is not valid or has expired' },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp('/join');
    await user.type(await screen.findByLabelText('Invite code'), 'WRONG');
    await user.type(screen.getByLabelText('Your name'), 'Mia');
    await user.type(screen.getByLabelText('Email'), 'mia@studio.test');
    await user.type(screen.getByLabelText('Password'), 'a-long-new-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-long-new-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not valid or has expired');
  });
});

function mockMembers(members: Member[], invites: Invite[] = []) {
  server.use(
    http.get('*/members', () => HttpResponse.json(members)),
    http.get('*/invites', () => HttpResponse.json(invites)),
  );
}

describe('members page', () => {
  it('lists members, hides actions for yourself, and hides the page from non-admins', async () => {
    mockHost({}, OWNER);
    mockMembers([OWNER_MEMBER, MIA, FREE]);
    renderApp('/members', 'tok');
    expect(await screen.findByText('mia@studio.test')).toBeInTheDocument();
    expect(screen.getByText(/Until .*2027/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Mia' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Owner' })).not.toBeInTheDocument();
  });

  it('redirects plain members away and hides the nav link', async () => {
    mockHost({}, { ...OWNER, role: 'member' });
    const { router } = renderApp('/members', 'tok');
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByRole('link', { name: 'Members' })).not.toBeInTheDocument();
  });

  it('admins cannot act on other admins or invite admins', async () => {
    mockHost({}, { ...OWNER, id: 'a1', role: 'admin' });
    mockMembers([
      { ...OWNER_MEMBER, id: 'a1', role: 'admin', name: 'Me' },
      { ...MIA, id: 'a2', name: 'Other Admin', role: 'admin' },
      MIA,
    ]);
    const user = userEvent.setup();
    renderApp('/members', 'tok');
    expect(await screen.findByRole('button', { name: 'Remove Mia' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Other Admin' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Invite someone' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('option', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('creates a guest invite and shows the code once', async () => {
    mockHost({}, OWNER);
    mockMembers([OWNER_MEMBER]);
    let sent: Record<string, unknown> = {};
    server.use(
      http.post('*/invites', async ({ request }) => {
        sent = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            id: 'i1',
            code: 'K7QX-M2PD-9WTA',
            role: 'guest',
            guestExpiresAt: sent.guestExpiresAt,
            createdAt: Date.now(),
            expiresAt: Date.now() + 1000,
            createdByName: 'Owner',
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderApp('/members', 'tok');
    await user.click(await screen.findByRole('button', { name: 'Invite someone' }));
    const dialog = await screen.findByRole('dialog');

    await user.selectOptions(within(dialog).getByLabelText('Role'), 'guest');
    // Guests need an end date.
    await user.click(within(dialog).getByRole('button', { name: 'Create invite' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Guests need an end date');

    await user.type(within(dialog).getByLabelText('Access ends on'), '2099-01-31');
    await user.click(within(dialog).getByRole('button', { name: 'Create invite' }));
    expect(await screen.findByLabelText('Invite code')).toHaveTextContent('K7QX-M2PD-9WTA');
    expect(sent).toMatchObject({ role: 'guest' });
    expect(typeof sent.guestExpiresAt).toBe('number');

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('K7QX-M2PD-9WTA')).not.toBeInTheDocument();
  });

  it('resets a password and shows the temporary one once', async () => {
    mockHost({}, OWNER);
    mockMembers([OWNER_MEMBER, MIA]);
    server.use(
      http.post('*/members/u2/reset-password', () =>
        HttpResponse.json({ temporaryPassword: 'ABCD-EFGH-JKMN-PQRS' }),
      ),
    );
    const user = userEvent.setup();
    renderApp('/members', 'tok');
    await user.click(await screen.findByRole('button', { name: 'Reset password for Mia' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset password' }),
    );
    expect(await screen.findByText('ABCD-EFGH-JKMN-PQRS')).toBeInTheDocument();
  });

  it('removes a member after confirmation, and Escape cancels', async () => {
    mockHost({}, OWNER);
    let members = [OWNER_MEMBER, MIA];
    server.use(
      http.get('*/members', () => HttpResponse.json(members)),
      http.get('*/invites', () => HttpResponse.json([])),
      http.delete('*/members/u2', () => {
        members = [OWNER_MEMBER];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/members', 'tok');

    await user.click(await screen.findByRole('button', { name: 'Remove Mia' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('loses access immediately');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('mia@studio.test')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Mia' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove member' }),
    );
    await waitFor(() => expect(screen.queryByText('mia@studio.test')).not.toBeInTheDocument());
  });

  it('lists pending invites and revokes one', async () => {
    mockHost({}, OWNER);
    let invites: Invite[] = [
      {
        id: 'i1',
        role: 'member',
        guestExpiresAt: null,
        createdAt: Date.now(),
        expiresAt: Date.now() + 86_400_000,
        createdByName: 'Owner',
      },
    ];
    server.use(
      http.get('*/members', () => HttpResponse.json([OWNER_MEMBER])),
      http.get('*/invites', () => HttpResponse.json(invites)),
      http.delete('*/invites/i1', () => {
        invites = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/members', 'tok');
    await user.click(await screen.findByRole('button', { name: 'Revoke member invite' }));
    expect(await screen.findByText('No pending invites.')).toBeInTheDocument();
  });
});

describe('account name', () => {
  it('saves a new display name', async () => {
    mockHost({}, OWNER);
    let sent: unknown;
    server.use(
      http.patch('*/auth/me', async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json({ ...OWNER, name: 'Renamed' });
      }),
    );
    const user = userEvent.setup();
    renderApp('/settings/account', 'tok');
    const field = await screen.findByLabelText('Display name');
    await user.clear(field);
    await user.type(field, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByText('Name saved.')).toBeInTheDocument();
    expect(sent).toEqual({ name: 'Renamed' });
  });
});
