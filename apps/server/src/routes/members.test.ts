import { memberListSchema, passwordResetSchema } from '@whiteboard/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';

let host: TestHost;
let owner: { token: string; workspaceId: string };
beforeEach(async () => {
  host = createTestHost();
  owner = await setupOwner(host);
});
afterEach(() => host.cleanup());

const call = (
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH',
  url: string,
  token?: string,
  payload?: object,
) => host.app.inject({ method, url, headers: token ? bearer(token) : undefined, payload });

describe('GET /members', () => {
  it('is for admins only and lists active members', async () => {
    const admin = await seedUser(host.db, owner.workspaceId, 'admin');
    const member = await seedUser(host.db, owner.workspaceId, 'member');
    const guest = await seedUser(host.db, owner.workspaceId, 'guest');

    const res = await call('GET', '/members', admin.token);
    expect(res.statusCode).toBe(200);
    expect(memberListSchema.parse(res.json())).toHaveLength(4);
    expect(JSON.stringify(res.json())).not.toMatch(/passwordHash|scrypt|token/i);

    expect((await call('GET', '/members', member.token)).statusCode).toBe(403);
    expect((await call('GET', '/members', guest.token)).statusCode).toBe(403);
    expect((await call('GET', '/members')).statusCode).toBe(401);
  });
});

describe('offboarding: DELETE /members/:id', () => {
  it('removes the member and kills their session at once', async () => {
    const member = await seedUser(host.db, owner.workspaceId, 'member');
    expect((await call('GET', '/auth/me', member.token)).statusCode).toBe(200);

    expect((await call('DELETE', `/members/${member.id}`, owner.token)).statusCode).toBe(204);

    expect((await call('GET', '/auth/me', member.token)).statusCode).toBe(401);
    const list = memberListSchema.parse((await call('GET', '/members', owner.token)).json());
    expect(list.some((m) => m.id === member.id)).toBe(false);
    const signIn = await call('POST', '/auth/sign-in', undefined, {
      email: member.email,
      password: member.password,
    });
    expect(signIn.statusCode).toBe(401);
  });

  it('follows the role hierarchy', async () => {
    const admin = await seedUser(host.db, owner.workspaceId, 'admin');
    const admin2 = await seedUser(host.db, owner.workspaceId, 'admin');
    const member = await seedUser(host.db, owner.workspaceId, 'member');
    const ownerId = memberListSchema
      .parse((await call('GET', '/members', owner.token)).json())
      .find((m) => m.role === 'owner')!.id;

    expect((await call('DELETE', `/members/${admin2.id}`, admin.token)).statusCode).toBe(403);
    expect((await call('DELETE', `/members/${ownerId}`, admin.token)).statusCode).toBe(403);
    expect((await call('DELETE', `/members/${ownerId}`, owner.token)).statusCode).toBe(400); // self
    expect((await call('DELETE', `/members/${admin.id}`, admin.token)).statusCode).toBe(400); // self
    expect((await call('DELETE', `/members/${member.id}`, admin.token)).statusCode).toBe(204);
    expect((await call('DELETE', `/members/${admin2.id}`, owner.token)).statusCode).toBe(204);
  });

  it('404s for unknown or already-removed members and 403s for plain members', async () => {
    const member = await seedUser(host.db, owner.workspaceId, 'member');
    const other = await seedUser(host.db, owner.workspaceId, 'member');
    expect((await call('DELETE', '/members/nope', owner.token)).statusCode).toBe(404);
    expect((await call('DELETE', `/members/${other.id}`, member.token)).statusCode).toBe(403);
    await call('DELETE', `/members/${other.id}`, owner.token);
    expect((await call('DELETE', `/members/${other.id}`, owner.token)).statusCode).toBe(404);
  });
});

describe('POST /members/:id/reset-password', () => {
  it('sets a temporary password, forces a change and signs the member out', async () => {
    const member = await seedUser(host.db, owner.workspaceId, 'member');
    const res = await call('POST', `/members/${member.id}/reset-password`, owner.token);
    expect(res.statusCode).toBe(200);
    const { temporaryPassword } = passwordResetSchema.parse(res.json());

    expect((await call('GET', '/auth/me', member.token)).statusCode).toBe(401);
    const old = await call('POST', '/auth/sign-in', undefined, {
      email: member.email,
      password: member.password,
    });
    expect(old.statusCode).toBe(401);

    const fresh = await call('POST', '/auth/sign-in', undefined, {
      email: member.email,
      password: temporaryPassword,
    });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().user.mustChangePassword).toBe(true);
    // Blocked from normal routes until they pick their own password.
    const token = fresh.json().token as string;
    expect((await call('GET', '/members', token)).statusCode).toBe(403);
    const change = await call('POST', '/auth/change-password', token, {
      currentPassword: temporaryPassword,
      newPassword: 'my-own-new-password',
    });
    expect(change.statusCode).toBe(204);
  });

  it('cannot be used on the owner, peers or yourself', async () => {
    const admin = await seedUser(host.db, owner.workspaceId, 'admin');
    const admin2 = await seedUser(host.db, owner.workspaceId, 'admin');
    expect(
      (await call('POST', `/members/${admin2.id}/reset-password`, admin.token)).statusCode,
    ).toBe(403);
    expect(
      (await call('POST', `/members/${admin.id}/reset-password`, admin.token)).statusCode,
    ).toBe(400);
    const ownerId = memberListSchema
      .parse((await call('GET', '/members', owner.token)).json())
      .find((m) => m.role === 'owner')!.id;
    expect((await call('POST', `/members/${ownerId}/reset-password`, admin.token)).statusCode).toBe(
      403,
    );
  });
});

describe('PATCH /auth/me', () => {
  it('updates the display name', async () => {
    const res = await call('PATCH', '/auth/me', owner.token, { name: '  New Name ' });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('New Name');
    expect((await call('GET', '/auth/me', owner.token)).json().name).toBe('New Name');
    expect((await call('PATCH', '/auth/me', owner.token, { name: '   ' })).statusCode).toBe(400);
  });
});
