import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { hostSettings } from '@whiteboard/db';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bearer, createTestHost, seedUser, setupOwner, type TestHost } from '../test-helpers';

let host: TestHost;
let owner: { token: string; workspaceId: string };
beforeEach(async () => {
  host = createTestHost();
  owner = await setupOwner(host);
});
afterEach(() => host.cleanup());

function multipartBody(name: string, content: Buffer, type = 'application/octet-stream') {
  const boundary = '----wbtest';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
      `Content-Type: ${type}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, content, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function upload(token: string, name: string, content: Buffer, claimedType?: string) {
  const { payload, contentType } = multipartBody(name, content, claimedType);
  return host.app.inject({
    method: 'POST',
    url: '/files',
    payload,
    headers: { ...bearer(token), 'content-type': contentType },
  });
}

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
const png = () =>
  sharp({ create: { width: 1000, height: 500, channels: 3, background: '#3366cc' } })
    .png()
    .toBuffer();

describe('POST /files', () => {
  it('stores a file, records its sha256 and size, and detects the type from the content', async () => {
    const res = await upload(owner.token, 'brief.pdf', pdf, 'application/pdf');
    expect(res.statusCode).toBe(201);
    const info = res.json();
    expect(info).toMatchObject({
      name: 'brief.pdf',
      mimeType: 'application/pdf',
      size: pdf.length,
      hasThumbnail: false,
    });
    expect(info.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect(existsSync(path.join(host.dataDir, 'files', info.id.slice(0, 2), info.id))).toBe(true);
  });

  it('makes a thumbnail for images', async () => {
    const res = await upload(owner.token, 'moodboard.png', await png());
    expect(res.statusCode).toBe(201);
    expect(res.json().mimeType).toBe('image/png');
    expect(res.json().hasThumbnail).toBe(true);

    const thumb = await host.app.inject({
      method: 'GET',
      url: `/files/${res.json().id}/thumbnail`,
      headers: bearer(owner.token),
    });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    const meta = await sharp(thumb.rawPayload).metadata();
    expect(meta.width).toBe(320);
  });

  it('trusts the content, not the name: an executable renamed to .jpg is refused', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]);
    const res = await upload(owner.token, 'holiday.jpg', exe, 'image/jpeg');
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toBe('unsupported_file');
  });

  it('refuses unknown binary content and empty files, and leaves nothing on disk', async () => {
    expect((await upload(owner.token, 'x.bin', Buffer.from([1, 2, 3, 0, 4]))).statusCode).toBe(415);
    expect((await upload(owner.token, 'empty.txt', Buffer.alloc(0))).statusCode).toBe(415);
    const tmp = path.join(host.dataDir, 'files', 'tmp');
    expect(existsSync(tmp) ? readdirSync(tmp) : []).toEqual([]);
  });

  it('accepts plain UTF-8 text by extension', async () => {
    const res = await upload(owner.token, 'notes.md', Buffer.from('# Brief\n\nhéllo ✓\n'));
    expect(res.statusCode).toBe(201);
    expect(res.json().mimeType).toBe('text/plain');
  });

  it('enforces the max upload size setting', async () => {
    host.db.insert(hostSettings).values({ key: 'maxUploadBytes', value: 100 }).run();
    const res = await upload(owner.token, 'big.txt', Buffer.alloc(5000, 'a'));
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe('file_too_large');
    const stored = path.join(host.dataDir, 'files');
    const leftovers = existsSync(stored)
      ? readdirSync(stored, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
      : [];
    expect(leftovers).toEqual([]);
  });

  it('needs a session and a multipart body', async () => {
    const anon = multipartBody('a.txt', Buffer.from('hi'));
    expect(
      (
        await host.app.inject({
          method: 'POST',
          url: '/files',
          payload: anon.payload,
          headers: { 'content-type': anon.contentType },
        })
      ).statusCode,
    ).toBe(401);
    const res = await host.app.inject({
      method: 'POST',
      url: '/files',
      payload: { nope: true },
      headers: bearer(owner.token),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /files/:id/content', () => {
  async function uploaded(content = Buffer.from('0123456789'), name = 'digits.txt') {
    const res = await upload(owner.token, name, content);
    return res.json().id as string;
  }
  const get = (id: string, headers: Record<string, string> = {}, token = owner.token) =>
    host.app.inject({
      method: 'GET',
      url: `/files/${id}/content`,
      headers: { ...bearer(token), ...headers },
    });

  it('serves the whole file with Accept-Ranges and safe headers', async () => {
    const id = await uploaded();
    const res = await get(id);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('0123456789');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/); // text is a download
  });

  it('serves byte ranges (206) incl. open-ended and suffix ranges', async () => {
    const id = await uploaded();
    const mid = await get(id, { range: 'bytes=2-4' });
    expect(mid.statusCode).toBe(206);
    expect(mid.body).toBe('234');
    expect(mid.headers['content-range']).toBe('bytes 2-4/10');
    expect(mid.headers['content-length']).toBe('3');

    expect((await get(id, { range: 'bytes=7-' })).body).toBe('789');
    expect((await get(id, { range: 'bytes=-3' })).body).toBe('789');
    expect((await get(id, { range: 'bytes=5-999' })).body).toBe('56789');
  });

  it('answers 416 for ranges outside the file', async () => {
    const id = await uploaded();
    const res = await get(id, { range: 'bytes=50-60' });
    expect(res.statusCode).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */10');
  });

  it('shows PDFs inline', async () => {
    const id = (await upload(owner.token, 'a b.pdf', pdf)).json().id as string;
    expect((await get(id)).headers['content-disposition']).toMatch(/^inline;/);
  });

  it('returns the stored bytes unchanged for a larger binary file', async () => {
    const big = await sharp({
      create: { width: 600, height: 600, channels: 3, background: '#aa5500' },
    })
      .jpeg()
      .toBuffer();
    const id = (await upload(owner.token, 'big.jpg', big)).json().id as string;
    expect(Buffer.compare((await get(id)).rawPayload, big)).toBe(0);
  });
});

describe('file access', () => {
  it('lets the uploader and admins read a file, and hides it from other members and guests', async () => {
    const author = await seedUser(host.db, owner.workspaceId, 'member');
    const other = await seedUser(host.db, owner.workspaceId, 'member');
    const guest = await seedUser(host.db, owner.workspaceId, 'guest');
    const admin = await seedUser(host.db, owner.workspaceId, 'admin');

    const id = (await upload(author.token, 'secret.pdf', pdf)).json().id as string;
    const status = async (token: string, suffix = '') =>
      (
        await host.app.inject({
          method: 'GET',
          url: `/files/${id}${suffix}`,
          headers: bearer(token),
        })
      ).statusCode;

    for (const suffix of ['', '/content']) {
      expect(await status(author.token, suffix), `author ${suffix}`).toBe(200);
      expect(await status(admin.token, suffix), `admin ${suffix}`).toBe(200);
      expect(await status(owner.token, suffix), `owner ${suffix}`).toBe(200);
      expect(await status(other.token, suffix), `other member ${suffix}`).toBe(404);
      expect(await status(guest.token, suffix), `guest ${suffix}`).toBe(404);
    }
    const anon = await host.app.inject({ method: 'GET', url: `/files/${id}/content` });
    expect(anon.statusCode).toBe(401);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await host.app.inject({
      method: 'GET',
      url: '/files/nope/content',
      headers: bearer(owner.token),
    });
    expect(res.statusCode).toBe(404);
  });
});
