import { hostInfoSchema } from '@whiteboard/core';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '../test/setup';
import { api, ApiError, getToken, setToken } from './api';

describe('api()', () => {
  it('sends the bearer token and validates the response', async () => {
    setToken('abc');
    let auth: string | null = null;
    server.use(
      http.get('*/host/info', ({ request }) => {
        auth = request.headers.get('authorization');
        return HttpResponse.json({ workspaceName: null, serverVersion: '1', setupDone: false });
      }),
    );
    const info = await api('/host/info', { schema: hostInfoSchema });
    expect(auth).toBe('Bearer abc');
    expect(info.setupDone).toBe(false);
  });

  it('maps the Host error body to ApiError', async () => {
    server.use(
      http.post('*/auth/sign-in', () =>
        HttpResponse.json(
          { error: 'invalid_credentials', message: 'Wrong email or password' },
          { status: 401 },
        ),
      ),
    );
    await expect(api('/auth/sign-in', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 401,
      code: 'invalid_credentials',
      message: 'Wrong email or password',
    });
  });

  it('drops the session when the Host answers 401', async () => {
    setToken('expired');
    server.use(
      http.get('*/auth/me', () =>
        HttpResponse.json({ error: 'unauthorized', message: 'x' }, { status: 401 }),
      ),
    );
    await expect(api('/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBeNull();
  });

  it('reports an unreachable Host as status 0', async () => {
    server.use(http.get('*/host/info', () => HttpResponse.error()));
    await expect(api('/host/info')).rejects.toMatchObject({ status: 0, code: 'unreachable' });
  });
});
