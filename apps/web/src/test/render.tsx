import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { HostInfo, SessionUser } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { Providers } from '../App';
import { setToken } from '../lib/api';
import { routes } from '../routes';
import { server } from './setup';

export const OWNER: SessionUser = {
  id: 'u1',
  email: 'owner@studio.test',
  name: 'Owner',
  role: 'owner',
  mustChangePassword: false,
};

export function mockHost(info: Partial<HostInfo> = {}, user: SessionUser | null = null) {
  server.use(
    http.get('*/host/info', () =>
      HttpResponse.json({
        workspaceName: 'Studio',
        serverVersion: '0.1.0',
        setupDone: true,
        ...info,
      }),
    ),
    http.get('*/auth/me', () =>
      user
        ? HttpResponse.json(user)
        : HttpResponse.json(
            { error: 'unauthorized', message: 'Sign in required' },
            { status: 401 },
          ),
    ),
  );
}

/** Renders the real route table at `path`. Pass `token` to start signed in. */
export function renderApp(path = '/', token?: string) {
  if (token) setToken(token);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...view, router };
}
