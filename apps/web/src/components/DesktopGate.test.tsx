import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { getHostUrl, getToken } from '../lib/api';
import { fakeDesktop, LOCAL_HOST } from '../test/desktop';
import { OWNER, renderApp } from '../test/render';
import { server } from '../test/setup';

describe('desktop app first run', () => {
  it('sets this PC up as the Host, starts its server and opens workspace setup', async () => {
    server.use(
      http.get(`${LOCAL_HOST}/host/info`, () =>
        HttpResponse.json({ workspaceName: null, serverVersion: '0.1.0', setupDone: false }),
      ),
    );
    const bridge = fakeDesktop(null);
    const user = userEvent.setup();
    renderApp('/', 'old-token');

    await user.click(await screen.findByRole('button', { name: 'Set up this PC as the Host' }));

    expect(await screen.findByRole('heading', { name: 'Set up Whiteboard' })).toBeInTheDocument();
    expect(bridge.setMode).toHaveBeenCalledWith('host');
    expect(bridge.startHost).toHaveBeenCalledTimes(1);
    expect(getHostUrl()).toBe(LOCAL_HOST);
    expect(getToken()).toBeNull();
  });

  it('sends a client PC to the Connect screen', async () => {
    const bridge = fakeDesktop(null);
    const user = userEvent.setup();
    renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'Connect to the office Host' }));

    expect(await screen.findByRole('heading', { name: 'Connect to a Host' })).toBeInTheDocument();
    expect(bridge.setMode).toHaveBeenCalledWith('client');
    expect(bridge.startHost).not.toHaveBeenCalled();
  });

  it('keeps the session when the app opens before its Host server answers', async () => {
    let meCalls = 0;
    server.use(
      http.get(`${LOCAL_HOST}/host/info`, () =>
        HttpResponse.json({ workspaceName: 'Studio', serverVersion: '0.1.0', setupDone: true }),
      ),
      http.get(`${LOCAL_HOST}/notifications`, () => HttpResponse.json({ items: [], unread: 0 })),
      // The first check runs while the server is still starting.
      http.get(`${LOCAL_HOST}/auth/me`, () =>
        ++meCalls === 1 ? HttpResponse.error() : HttpResponse.json(OWNER),
      ),
    );
    localStorage.setItem('wb.hostUrl', LOCAL_HOST);
    fakeDesktop('host');
    renderApp('/', 'saved-token');

    expect(await screen.findByText(/Welcome, Owner/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(getToken()).toBe('saved-token');
  });

  it('explains when the Host server does not start, and tries again', async () => {
    const startHost = vi.fn(async (): Promise<string> => {
      throw 'The Host server did not start. Details: C:\\logs\\server.log';
    });
    fakeDesktop('host', { startHost });
    const user = userEvent.setup();
    renderApp('/');

    expect(await screen.findByRole('alert')).toHaveTextContent('Details: C:\\logs\\server.log');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(startHost).toHaveBeenCalledTimes(2);
  });
});

describe('desktop app: finding the Host on the network', () => {
  it('lists the Hosts it finds and connects with one click', async () => {
    const OFFICE = 'http://192.168.1.20:47800';
    server.use(
      http.get(`${OFFICE}/host/info`, () =>
        HttpResponse.json({ workspaceName: 'Studio', serverVersion: '0.1.0', setupDone: true }),
      ),
      http.get(`${OFFICE}/auth/me`, () =>
        HttpResponse.json({ error: 'unauthorized', message: 'Sign in required' }, { status: 401 }),
      ),
    );
    fakeDesktop('client', {
      discoverHosts: vi.fn(async () => [{ name: 'Whiteboard on OFFICE-PC', url: OFFICE }]),
    });
    const user = userEvent.setup();
    renderApp('/');

    const found = await screen.findByRole('region', { name: 'Hosts found on this network' });
    await user.click(await within(found).findByRole('button', { name: /Whiteboard on OFFICE-PC/ }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(getHostUrl()).toBe(OFFICE);
  });

  it('says when nothing answers, and searches again on request', async () => {
    const bridge = fakeDesktop('client');
    const user = userEvent.setup();
    renderApp('/connect');

    expect(await screen.findByText(/No Host found/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Search again' }));
    await waitFor(() => expect(bridge.discoverHosts).toHaveBeenCalledTimes(2));
  });
});
