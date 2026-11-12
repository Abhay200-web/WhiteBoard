import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { mockHost, OWNER, renderApp } from '../test/render';
import { server } from '../test/setup';

describe('route guards', () => {
  it('sends a brand-new Host to the setup wizard', async () => {
    mockHost({ setupDone: false, workspaceName: null });
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Set up Whiteboard' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
  });

  it('sends a signed-out visitor to sign in', async () => {
    mockHost();
    const { router } = renderApp('/settings');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('shows the app to a signed-in user and keeps them out of /login', async () => {
    mockHost({}, OWNER);
    const { router } = renderApp('/login', 'tok');
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('closes /setup once the Host is set up', async () => {
    mockHost();
    const { router } = renderApp('/setup');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('falls back to sign in when the stored session has expired', async () => {
    mockHost({}, null);
    renderApp('/', 'stale-token');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('explains when the Host cannot be reached', async () => {
    server.use(http.get('*/host/info', () => HttpResponse.error()));
    renderApp('/');
    expect(
      await screen.findByRole('heading', { name: 'Cannot reach the Host' }),
    ).toBeInTheDocument();
  });
});
