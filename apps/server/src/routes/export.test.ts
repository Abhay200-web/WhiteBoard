import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';

let host: TestHost;
let owner: { token: string; workspaceId: string };
beforeEach(async () => {
  host = createTestHost();
  owner = await setupOwner(host);
});
afterEach(() => host.cleanup());

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: object) =>
  host.app.inject({ method, url, payload, headers: bearer(token) });

describe('project export', () => {
  it('exports Markdown and PDF for people on the project, and hides it from outsiders', async () => {
    const manager = await seedUser(host.db, owner.workspaceId, 'member');
    const artist = await seedUser(host.db, owner.workspaceId, 'member');
    const outsider = await seedUser(host.db, owner.workspaceId, 'member');
    const project = (
      await call('POST', '/projects', manager.token, { name: 'Exported' })
    ).json() as { id: string };
    const url = `/projects/${project.id}`;

    await call('POST', `${url}/members`, manager.token, { userId: artist.id, role: 'artist' });
    const finished = (
      await call('POST', `${url}/tasks`, manager.token, {
        title: 'Logo concepts',
        assigneeIds: [artist.id],
      })
    ).json() as { id: string };
    await call('POST', `${url}/tasks`, manager.token, { title: 'Brief' });
    const statuses = (await call('GET', `${url}/statuses`, manager.token)).json() as {
      id: string;
      kind: string;
    }[];
    const done = statuses.find((s) => s.kind === 'done')!;
    await call('PATCH', `/tasks/${finished.id}`, manager.token, { statusId: done.id });

    const markdown = await call('GET', `${url}/export?format=markdown`, manager.token);
    expect(markdown.statusCode).toBe(200);
    expect(markdown.headers['content-type']).toContain('text/markdown');
    expect(markdown.headers['content-disposition']).toContain('Exported - export.md');
    expect(markdown.body).toContain('# Exported');
    expect(markdown.body).toContain('- [x] Logo concepts (priority medium, due none, assigned to');
    expect(markdown.body).toContain('- [ ] Brief (priority medium, due none)');

    const pdf = await call('GET', `${url}/export?format=pdf`, manager.token);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');

    expect((await call('GET', `${url}/export?format=word`, manager.token)).statusCode).toBe(400);
    expect((await call('GET', `${url}/export?format=pdf`, outsider.token)).statusCode).toBe(404);
    expect((await call('GET', `${url}/export?format=pdf`, '')).statusCode).toBe(401);
  });
});
