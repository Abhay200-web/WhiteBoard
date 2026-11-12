import { WORKSPACE_ROLES, type WorkspaceRole } from '@whiteboard/core';
import { workspaces } from '@whiteboard/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestHost, seedUser, SETUP_BODY, type TestHost } from '../test-helpers';
import { ADMIN_ROLES, ALL_ROLES, authenticate, requireRole } from './auth';

let host: TestHost;
beforeEach(() => {
  host = createTestHost();
  host.app.register(async (scope) => {
    const db = host.db;
    scope.get('/t/any', { preHandler: [authenticate(db), requireRole(ALL_ROLES)] }, async () => ({
      ok: 1,
    }));
    scope.get(
      '/t/admin',
      { preHandler: [authenticate(db), requireRole(ADMIN_ROLES)] },
      async () => ({ ok: 1 }),
    );
    scope.get('/t/owner', { preHandler: [authenticate(db), requireRole(['owner'])] }, async () => ({
      ok: 1,
    }));
  });
});
afterEach(() => host.cleanup());

// route -> roles that may call it. This is the permission matrix; extend it with every new route.
const MATRIX: Record<string, readonly WorkspaceRole[]> = {
  '/t/any': ['owner', 'admin', 'member', 'guest'],
  '/t/admin': ['owner', 'admin'],
  '/t/owner': ['owner'],
};

describe('permission middleware', () => {
  it('matches the role matrix for every route and role', async () => {
    await host.app.inject({ method: 'POST', url: '/setup', payload: SETUP_BODY });
    const ws = host.db.select().from(workspaces).get()!;
    for (const role of WORKSPACE_ROLES) {
      const { token } = await seedUser(host.db, ws.id, role);
      for (const [url, allowed] of Object.entries(MATRIX)) {
        const res = await host.app.inject({
          method: 'GET',
          url,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode, `${role} ${url}`).toBe(allowed.includes(role) ? 200 : 403);
      }
    }
  });

  it('returns 401 without a token on every route', async () => {
    for (const url of Object.keys(MATRIX)) {
      expect((await host.app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
    }
  });

  it('blocks users who must change their password from normal routes', async () => {
    await host.app.inject({ method: 'POST', url: '/setup', payload: SETUP_BODY });
    const ws = host.db.select().from(workspaces).get()!;
    const { token } = await seedUser(host.db, ws.id, 'member', { mustChangePassword: true });
    const res = await host.app.inject({
      method: 'GET',
      url: '/t/any',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('password_change_required');
  });
});
