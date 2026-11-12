import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionUser } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { getToken } from '../lib/api';
import { mockHost, OWNER, renderApp } from '../test/render';
import { server } from '../test/setup';

const MEMBER: SessionUser = { ...OWNER, id: 'u2', name: 'Mia', role: 'member' };

function authBody(user: SessionUser, token = 'tok-1') {
  return { token, expiresAt: Date.now() + 1000, user };
}

describe('setup wizard', () => {
  it('validates before sending anything', async () => {
    mockHost({ setupDone: false, workspaceName: null });
    let posted = false;
    server.use(http.post('*/setup', () => ((posted = true), HttpResponse.json({}))));
    const user = userEvent.setup();
    renderApp('/setup');

    await user.type(await screen.findByLabelText('Workspace name'), 'Studio');
    await user.type(screen.getByLabelText('Your name'), 'Owner');
    await user.type(screen.getByLabelText('Email'), 'owner@studio.test');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(
      await screen.findByText(/at least 10 characters/i, { selector: 'p.text-danger' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(posted).toBe(false);
  });

  it('creates the workspace and lands on Home signed in', async () => {
    let setupDone = false;
    server.use(
      http.get('*/host/info', () =>
        HttpResponse.json({
          workspaceName: setupDone ? 'Studio' : null,
          serverVersion: '0.1.0',
          setupDone,
        }),
      ),
      http.get('*/auth/me', () => HttpResponse.json(OWNER)),
      http.post('*/setup', async ({ request }) => {
        const body = (await request.json()) as Record<string, string>;
        expect(body).toMatchObject({ workspaceName: 'Studio', email: 'owner@studio.test' });
        setupDone = true;
        return HttpResponse.json(authBody(OWNER), { status: 201 });
      }),
    );
    const user = userEvent.setup();
    const { router } = renderApp('/');

    await user.type(await screen.findByLabelText('Workspace name'), 'Studio');
    await user.type(screen.getByLabelText('Your name'), 'Owner');
    await user.type(screen.getByLabelText('Email'), 'Owner@Studio.test');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await user.type(screen.getByLabelText('Confirm password'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(getToken()).toBe('tok-1');
  });

  it('shows the Host error if setup was already done elsewhere', async () => {
    mockHost({ setupDone: false, workspaceName: null });
    server.use(
      http.post('*/setup', () =>
        HttpResponse.json(
          { error: 'already_set_up', message: 'This Host is already set up' },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp('/setup');
    await user.type(await screen.findByLabelText('Workspace name'), 'Studio');
    await user.type(screen.getByLabelText('Your name'), 'Owner');
    await user.type(screen.getByLabelText('Email'), 'owner@studio.test');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await user.type(screen.getByLabelText('Confirm password'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Create workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This Host is already set up');
  });
});

describe('login', () => {
  it('signs in and goes to Home', async () => {
    mockHost({}, OWNER);
    server.use(http.post('*/auth/sign-in', () => HttpResponse.json(authBody(OWNER))));
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), 'owner@studio.test');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('shows wrong-password and rate-limit errors', async () => {
    mockHost();
    let calls = 0;
    server.use(
      http.post('*/auth/sign-in', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(
              { error: 'invalid_credentials', message: 'Wrong email or password' },
              { status: 401 },
            )
          : HttpResponse.json({ error: 'rate_limited', message: 'x' }, { status: 429 });
      }),
    );
    const user = userEvent.setup();
    renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), 'a@b.test');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too many attempts/i));
  });

  it('forces a new password when an admin set it, then continues', async () => {
    const temp: SessionUser = { ...MEMBER, mustChangePassword: true };
    let current: SessionUser = temp;
    server.use(
      http.get('*/host/info', () =>
        HttpResponse.json({ workspaceName: 'Studio', serverVersion: '0.1.0', setupDone: true }),
      ),
      http.get('*/auth/me', () => HttpResponse.json(current)),
      http.post('*/auth/sign-in', () => HttpResponse.json(authBody(temp))),
      http.post('*/auth/change-password', () => {
        current = { ...MEMBER, mustChangePassword: false };
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    const { router } = renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), 'mia@studio.test');
    await user.type(screen.getByLabelText('Password'), 'temporary-pass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/change-password');

    await user.type(screen.getByLabelText('Current password'), 'temporary-pass');
    await user.type(screen.getByLabelText('New password'), 'my-own-new-password');
    await user.type(screen.getByLabelText('Confirm new password'), 'my-own-new-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });
});

describe('app shell and settings', () => {
  it('shows Account and Connection but hides Host for members', async () => {
    mockHost({}, MEMBER);
    renderApp('/settings', 'tok');
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(nav).toHaveTextContent('Account');
    expect(nav).toHaveTextContent('Connection');
    expect(nav).not.toHaveTextContent('Host');
  });

  it('keeps members out of the Host section', async () => {
    mockHost({}, MEMBER);
    const { router } = renderApp('/settings/host', 'tok');
    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings/account');
  });

  it('shows the Host section to owners and the connection details', async () => {
    mockHost({ serverVersion: '9.9.9' }, OWNER);
    const user = userEvent.setup();
    renderApp('/settings', 'tok');
    await user.click(await screen.findByRole('link', { name: 'Connection' }));
    expect(await screen.findByText('9.9.9')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Host' })).toBeInTheDocument();
  });

  it('signs out and returns to the login screen', async () => {
    mockHost({}, OWNER);
    server.use(http.post('*/auth/sign-out', () => new HttpResponse(null, { status: 204 })));
    const user = userEvent.setup();
    renderApp('/', 'tok');
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });
});
