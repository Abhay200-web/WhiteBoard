import { authResponseSchema, createdInviteSchema, inviteListSchema } from '@whiteboard/core';
import { invites } from '@whiteboard/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  bearer,
  createTestHost,
  removeMember,
  seedUser,
  setupOwner,
  type TestHost,
} from '../test-helpers';

let host: TestHost;
let owner: { token: string; workspaceId: string };
beforeEach(async () => {
  host = createTestHost();
  owner = await setupOwner(host);
});
afterEach(() => host.cleanup());

const DAY = 24 * 60 * 60 * 1000;

async function createInvite(token: string, payload: object) {
  return host.app.inject({ method: 'POST', url: '/invites', headers: bearer(token), payload });
}
async function accept(payload: object) {
  return host.app.inject({ method: 'POST', url: '/invites/accept', payload });
}
const JOIN = { name: 'Mia', email: 'mia@studio.test', password: 'a-long-new-password' };

describe('creating invites', () => {
  it('lets the owner invite a member and shows the code once', async () => {
    const res = await createInvite(owner.token, { role: 'member' });
    expect(res.statusCode).toBe(201);
    const invite = createdInviteSchema.parse(res.json());
    expect(invite.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const list = await host.app.inject({
      method: 'GET',
      url: '/invites',
      headers: bearer(owner.token),
    });
    const pending = inviteListSchema.parse(list.json());
    expect(pending).toHaveLength(1);
    expect(JSON.stringify(list.json())).not.toContain(invite.code);
  });

  it('stores only a hash of the code', async () => {
    const invite = createdInviteSchema.parse(
      (await createInvite(owner.token, { role: 'member' })).json(),
    );
    const [row] = host.db.select().from(invites).all();
    expect(row?.codeHash).not.toContain(invite.code.replaceAll('-', ''));
  });

  it('requires an end date for guests and rejects one for others', async () => {
    expect((await createInvite(owner.token, { role: 'guest' })).statusCode).toBe(400);
    expect(
      (await createInvite(owner.token, { role: 'member', guestExpiresAt: Date.now() + DAY }))
        .statusCode,
    ).toBe(400);
    expect(
      (await createInvite(owner.token, { role: 'guest', guestExpiresAt: Date.now() - DAY }))
        .statusCode,
    ).toBe(400);
    expect(
      (await createInvite(owner.token, { role: 'guest', guestExpiresAt: Date.now() + DAY }))
        .statusCode,
    ).toBe(201);
  });

  it('enforces who may invite whom', async () => {
    const admin = await seedUser(host.db, owner.workspaceId, 'admin');
    const member = await seedUser(host.db, owner.workspaceId, 'member');
    const guest = await seedUser(host.db, owner.workspaceId, 'guest');

    expect((await createInvite(admin.token, { role: 'member' })).statusCode).toBe(201);
    expect((await createInvite(admin.token, { role: 'admin' })).statusCode).toBe(403);
    expect((await createInvite(owner.token, { role: 'admin' })).statusCode).toBe(201);
    expect((await createInvite(member.token, { role: 'member' })).statusCode).toBe(403);
    expect((await createInvite(guest.token, { role: 'member' })).statusCode).toBe(403);
    expect(
      (await host.app.inject({ method: 'POST', url: '/invites', payload: {} })).statusCode,
    ).toBe(401);
  });

  it('can revoke a pending invite', async () => {
    const invite = createdInviteSchema.parse(
      (await createInvite(owner.token, { role: 'member' })).json(),
    );
    const del = await host.app.inject({
      method: 'DELETE',
      url: `/invites/${invite.id}`,
      headers: bearer(owner.token),
    });
    expect(del.statusCode).toBe(204);
    expect((await accept({ code: invite.code, ...JOIN })).statusCode).toBe(400);
    const again = await host.app.inject({
      method: 'DELETE',
      url: `/invites/${invite.id}`,
      headers: bearer(owner.token),
    });
    expect(again.statusCode).toBe(404);
  });
});

describe('accepting invites', () => {
  it('creates the account with the invited role and signs them in', async () => {
    const invite = createdInviteSchema.parse(
      (await createInvite(owner.token, { role: 'member' })).json(),
    );
    // Codes are read aloud: lowercase and missing dashes must still work.
    const res = await accept({ code: invite.code.toLowerCase().replaceAll('-', ' '), ...JOIN });
    expect(res.statusCode).toBe(201);
    const auth = authResponseSchema.parse(res.json());
    expect(auth.user).toMatchObject({ email: 'mia@studio.test', role: 'member' });

    const me = await host.app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: bearer(auth.token),
    });
    expect(me.statusCode).toBe(200);
  });

  it('works only once', async () => {
    const invite = createdInviteSchema.parse(
      (await createInvite(owner.token, { role: 'member' })).json(),
    );
    expect((await accept({ code: invite.code, ...JOIN })).statusCode).toBe(201);
    const second = await accept({ code: invite.code, ...JOIN, email: 'other@studio.test' });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe('invalid_invite');
  });

  it('gives guests their end date, and the invite stays unused if the email is taken', async () => {
    const end = Date.now() + 5 * DAY;
    const invite = createdInviteSchema.parse(
      (await createInvite(owner.token, { role: 'guest', guestExpiresAt: end })).json(),
    );
    const taken = await accept({ code: invite.code, ...JOIN, email: 'owner@studio.test' });
    expect(taken.statusCode).toBe(409);

    const ok = await accept({ code: invite.code, ...JOIN });
    expect(ok.statusCode).toBe(201);
    const members = await host.app.inject({
      method: 'GET',
      url: '/members',
      headers: bearer(owner.token),
    });
    expect(
      members.json().find((m: { email: string }) => m.email === 'mia@studio.test'),
    ).toMatchObject({
      role: 'guest',
      expiresAt: end,
    });
  });

  it('rejects wrong, expired and past-end-date codes with one generic error', async () => {
    const stale = createdInviteSchema.parse(
      (await createInvite(owner.token, { role: 'member' })).json(),
    );
    host.db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .run();
    const soonGone = createdInviteSchema.parse(
      (await createInvite(owner.token, { role: 'guest', guestExpiresAt: Date.now() + 50 })).json(),
    );
    await new Promise((r) => setTimeout(r, 80));

    const results = await Promise.all([
      accept({ code: 'AAAA-BBBB-CCCC', ...JOIN }),
      accept({ code: stale.code, ...JOIN }),
      accept({ code: soonGone.code, ...JOIN }),
    ]);
    for (const r of results) {
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe('invalid_invite');
    }
  });

  it('is rate limited against code guessing', async () => {
    await host.cleanup();
    host = createTestHost({ authRateLimit: { max: 2, timeWindow: '1 minute' } });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++)
      codes.push((await accept({ code: 'AAAA-BBBB-CCCC', ...JOIN })).statusCode);
    expect(codes).toEqual([400, 400, 429, 429]);
  });

  it('a removed member cannot sign in again with a new invite using the same email', async () => {
    const gone = await seedUser(host.db, owner.workspaceId, 'member', { email: 'mia@studio.test' });
    removeMember(host.db, gone.id);
    const invite = createdInviteSchema.parse(
      (await createInvite(owner.token, { role: 'member' })).json(),
    );
    expect((await accept({ code: invite.code, ...JOIN })).statusCode).toBe(409);
  });
});
