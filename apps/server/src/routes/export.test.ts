import { unzipSync } from 'fflate';
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

/** Uploads a small text file with `POST /files` and returns its id. */
async function upload(token: string, name: string, text: string): Promise<string> {
  const boundary = '----wbexport';
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
        'Content-Type: text/plain\r\n\r\n',
    ),
    Buffer.from(text),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await host.app.inject({
    method: 'POST',
    url: '/files',
    payload,
    headers: {
      ...bearer(token),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
  });
  return (res.json() as { id: string }).id;
}

describe('project export', () => {
  it('exports Markdown, PDF, Word and a zip for people on the project, and hides it from outsiders', async () => {
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

    const word = await call('GET', `${url}/export?format=docx`, manager.token);
    expect(word.statusCode).toBe(200);
    expect(word.headers['content-type']).toContain('wordprocessingml');
    expect(word.headers['content-disposition']).toContain('Exported - export.docx');
    expect(word.rawPayload.subarray(0, 2).toString()).toBe('PK');

    // The zip holds project.md, a project file, and a task file in its task folder.
    const brief = await upload(manager.token, 'brief.txt', 'Make it bold');
    const fileNamed = await upload(manager.token, 'brief.txt', 'Second copy');
    expect((await call('POST', `${url}/files`, manager.token, { fileId: brief })).statusCode).toBe(
      201,
    );
    expect(
      (await call('POST', `/tasks/${finished.id}/files`, manager.token, { fileId: fileNamed }))
        .statusCode,
    ).toBe(201);
    const zip = await call('GET', `${url}/export?format=zip`, manager.token);
    expect(zip.statusCode).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    const entries = unzipSync(new Uint8Array(zip.rawPayload));
    expect(Object.keys(entries).sort()).toEqual([
      'files/brief.txt',
      'project.md',
      'tasks/Logo concepts/brief.txt',
    ]);
    expect(new TextDecoder().decode(entries['files/brief.txt'])).toBe('Make it bold');
    expect(new TextDecoder().decode(entries['project.md'])).toContain('# Exported');

    expect((await call('GET', `${url}/export?format=word`, manager.token)).statusCode).toBe(400);
    expect((await call('GET', `${url}/export?format=pdf`, outsider.token)).statusCode).toBe(404);
    expect((await call('GET', `${url}/export?format=zip`, '')).statusCode).toBe(401);
  });
});
