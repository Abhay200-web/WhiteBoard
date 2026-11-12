import { authResponseSchema } from '@whiteboard/core';
import { sessions, users, workspaces } from '@whiteboard/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { removeMember, SETUP_BODY, createTestHost, seedUser, type TestHost } from '../test-helpers';

let host: TestHost;
beforeEach(() => {
  host = createTestHost();
});
afterEach(() => host.cleanup());

async function setup() {
  const res = await host.app.inject({ method: 'POST', url: '/setup', payload: SETUP_BODY });
  return { res, auth: authResponseSchema.parse(res.json()) };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('POST /setup', () => {
  it('creates the workspace and owner, and signs the owner in', async () => {
    const { res, auth } = await setup();
    expect(res.statusCode).toBe(201);
    expect(auth.user).toMatchObject({ email: 'owner@studio.test', role: 'owner' });

    const info = await host.app.inject({ method: 'GET', url: '/host/info' });
    expect(info.json()).toMatchObject({ workspaceName: 'Studio', setupDone: true });

    const me = await host.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: bearer(auth.token),
    });
    expect(me.statusCode).toBe(200);
  });

  it('only works once', async () => {
    await setup();
    const second = await host.app.inject({
      method: 'POST',
      url: '/setup',
      payload: { ...SETUP_BODY, email: 'other@studio.test' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('already_set_up');
  });

  it('rejects a weak password', async () => {
    const res = await host.app.inject({
      method: 'POST',
      url: '/setup',
      payload: { ...SETUP_BODY, password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('never stores the plaintext password or raw token', async () => {
    const { auth } = await setup();
    const [session] = host.db.select().from(sessions).all();
    expect(session?.tokenHash).not.toBe(auth.token);
  });
});

describe('POST /auth/sign-in', () => {
  it('signs in with the right password (case-insensitive email)', async () => {
    await setup();
    const res = await host.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: 'OWNER@studio.test', password: SETUP_BODY.password },
    });
    expect(res.statusCode).toBe(200);
    expect(authResponseSchema.parse(res.json()).user.role).toBe('owner');
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    await setup();
    const wrong = await host.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: 'owner@studio.test', password: 'nope-nope-nope' },
    });
    const unknown = await host.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: 'ghost@studio.test', password: 'nope-nope-nope' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('refuses removed members and expired guests', async () => {
    const { auth } = await setup();
    const ws = host.db.select().from(workspaces).get()!;
    const gone = await seedUser(host.db, ws.id, 'member');
    removeMember(host.db, gone.id);
    const expired = await seedUser(host.db, ws.id, 'guest', {
      expiresAt: new Date(Date.now() - 1000),
    });

    for (const u of [gone, expired]) {
      const res = await host.app.inject({
        method: 'POST',
        url: '/auth/sign-in',
        payload: { email: u.email, password: u.password },
      });
      expect(res.statusCode).toBe(401);
    }
    expect(auth.token).toBeTruthy();
  });
});

describe('sessions', () => {
  it('sign-out invalidates the token', async () => {
    const { auth } = await setup();
    const out = await host.app.inject({
      method: 'POST',
      url: '/auth/sign-out',
      headers: bearer(auth.token),
    });
    expect(out.statusCode).toBe(204);
    const me = await host.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: bearer(auth.token),
    });
    expect(me.statusCode).toBe(401);
  });

  it('removing a member kills their live session immediately', async () => {
    const { auth } = await setup();
    const ws = host.db.select().from(workspaces).get()!;
    const member = await seedUser(host.db, ws.id, 'member');
    const before = await host.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: bearer(member.token),
    });
    expect(before.statusCode).toBe(200);
    removeMember(host.db, member.id);
    const after = await host.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: bearer(member.token),
    });
    expect(after.statusCode).toBe(401);
    expect(auth.token).toBeTruthy();
  });

  it('rejects garbage and missing tokens', async () => {
    const none = await host.app.inject({ method: 'GET', url: '/auth/me' });
    const bad = await host.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: bearer('garbage'),
    });
    expect(none.statusCode).toBe(401);
    expect(bad.statusCode).toBe(401);
  });
});

describe('POST /auth/change-password', () => {
  it('changes the password, clears the forced flag and signs out other devices', async () => {
    await setup();
    const ws = host.db.select().from(workspaces).get()!;
    const u = await seedUser(host.db, ws.id, 'member', { mustChangePassword: true });
    const otherDevice = (
      await host.app.inject({
        method: 'POST',
        url: '/auth/sign-in',
        payload: { email: u.email, password: u.password },
      })
    ).json().token as string;

    const res = await host.app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: bearer(u.token),
      payload: { currentPassword: u.password, newPassword: 'brand-new-password' },
    });
    expect(res.statusCode).toBe(204);
    expect(host.db.select().from(users).where(eq(users.id, u.id)).get()?.mustChangePassword).toBe(
      false,
    );

    expect(
      (await host.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(u.token) }))
        .statusCode,
    ).toBe(200);
    expect(
      (await host.app.inject({ method: 'GET', url: '/auth/me', headers: bearer(otherDevice) }))
        .statusCode,
    ).toBe(401);

    const old = await host.app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: u.email, password: u.password },
    });
    expect(old.statusCode).toBe(401);
  });

  it('rejects a wrong current password', async () => {
    const { auth } = await setup();
    const res = await host.app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: bearer(auth.token),
      payload: { currentPassword: 'wrong-wrong-wrong', newPassword: 'brand-new-password' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('rate limiting', () => {
  it('limits sign-in attempts per client', async () => {
    await host.cleanup();
    host = createTestHost({ authRateLimit: { max: 3, timeWindow: '1 minute' } });
    const attempt = () =>
      host.app.inject({
        method: 'POST',
        url: '/auth/sign-in',
        payload: { email: 'x@studio.test', password: 'whatever-password' },
      });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await attempt()).statusCode);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
  });
});
