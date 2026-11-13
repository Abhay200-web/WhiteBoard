import multipart from '@fastify/multipart';
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  fileSchema,
  type FileInfo,
  type WorkspaceRole,
} from '@whiteboard/core';
import { files, hostSettings, type Db } from '@whiteboard/db';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { authenticate, requireRole, sendError, ADMIN_ROLES, ALL_ROLES } from '../plugins/auth';
import {
  UnsupportedFileError,
  fileExists,
  openRead,
  parseRange,
  removeStored,
  resolveStoragePath,
  storeUpload,
} from '../files/storage';

const MAX_UPLOAD_SETTING = 'maxUploadBytes';

export function getMaxUploadBytes(db: Db): number {
  const row = db.select().from(hostSettings).where(eq(hostSettings.key, MAX_UPLOAD_SETTING)).get();
  return typeof row?.value === 'number' && row.value > 0 ? row.value : DEFAULT_MAX_UPLOAD_BYTES;
}

type FileRow = typeof files.$inferSelect;

/**
 * Who may read a file. For now: the uploader and workspace admins. Part 3.6 adds "members of a
 * project the file is attached to" here — every file route goes through this one function.
 */
export function canAccessFile(auth: { user: { id: string; role: WorkspaceRole } }, file: FileRow) {
  return file.uploadedBy === auth.user.id || ADMIN_ROLES.some((r) => r === auth.user.role);
}

/** Types a browser can show in place; everything else is downloaded. */
const INLINE_MIME = /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf|video\/(mp4|webm))$/;

function toInfo(row: FileRow): FileInfo {
  return fileSchema.parse({
    id: row.id,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    sha256: row.sha256,
    hasThumbnail: row.thumbnailPath !== null,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.getTime(),
  });
}

/** `attachment; filename="..."` safe for any name (ASCII fallback + RFC 5987 form). */
function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export const fileRoutes: FastifyPluginAsync<{ db: Db; dataDir: string }> = async (
  app,
  { db, dataDir },
) => {
  // No global size limit here: the per-request limit comes from the host setting.
  await app.register(multipart, { limits: { files: 1, fields: 0, parts: 2 } });
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];

  app.post('/files', { preHandler: signedIn }, async (request, reply) => {
    if (!request.isMultipart()) {
      return sendError(reply, 400, 'invalid_request', 'Send the file as multipart/form-data');
    }
    const maxBytes = getMaxUploadBytes(db);
    const part = await request.file({ limits: { fileSize: maxBytes } });
    if (!part) return sendError(reply, 400, 'invalid_request', 'No file was sent');

    const name = (part.filename || 'file').slice(0, 255);
    let stored;
    try {
      stored = await storeUpload(dataDir, part.file, name);
    } catch (err) {
      if (err instanceof UnsupportedFileError) {
        return sendError(reply, 415, 'unsupported_file', err.message);
      }
      throw err;
    }
    if (part.file.truncated) {
      await removeStored(dataDir, stored.storagePath, stored.thumbnailPath);
      return sendError(reply, 413, 'file_too_large', `Files can be at most ${maxBytes} bytes`);
    }

    const row: FileRow = {
      id: stored.id,
      name,
      mimeType: stored.mimeType,
      size: stored.size,
      sha256: stored.sha256,
      storagePath: stored.storagePath,
      thumbnailPath: stored.thumbnailPath,
      uploadedBy: request.auth!.user.id,
      createdAt: new Date(),
    };
    db.insert(files).values(row).run();
    return reply.code(201).send(toInfo(row));
  });

  /** Loads the file and checks access; 404 for both "missing" and "not yours" (no probing). */
  function findAccessible(request: FastifyRequest) {
    const { id } = request.params as { id: string };
    const row = db.select().from(files).where(eq(files.id, id)).get();
    return row && canAccessFile(request.auth!, row) ? row : null;
  }

  app.get('/files/:id', { preHandler: signedIn }, async (request, reply) => {
    const row = findAccessible(request);
    if (!row) return sendError(reply, 404, 'not_found', 'File not found');
    return toInfo(row);
  });

  app.get('/files/:id/thumbnail', { preHandler: signedIn }, async (request, reply) => {
    const row = findAccessible(request);
    if (!row?.thumbnailPath) return sendError(reply, 404, 'not_found', 'No thumbnail');
    const full = resolveStoragePath(dataDir, row.thumbnailPath);
    if (!(await fileExists(full))) return sendError(reply, 404, 'not_found', 'No thumbnail');
    return reply
      .header('content-type', 'image/webp')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, max-age=3600')
      .send(openRead(full));
  });

  app.get('/files/:id/content', { preHandler: signedIn }, async (request, reply) => {
    const row = findAccessible(request);
    if (!row) return sendError(reply, 404, 'not_found', 'File not found');
    const full = resolveStoragePath(dataDir, row.storagePath);
    if (!(await fileExists(full))) return sendError(reply, 404, 'not_found', 'File not found');

    const range = parseRange(request.headers.range, row.size);
    if (range === 'invalid') {
      return reply
        .code(416)
        .header('content-range', `bytes */${row.size}`)
        .send({ error: 'range_not_satisfiable', message: 'Requested range is outside the file' });
    }

    reply
      .header('content-type', row.mimeType)
      .header('accept-ranges', 'bytes')
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-cache')
      .header(
        'content-disposition',
        contentDisposition(INLINE_MIME.test(row.mimeType) ? 'inline' : 'attachment', row.name),
      );
    if (range) {
      return reply
        .code(206)
        .header('content-range', `bytes ${range.start}-${range.end}/${row.size}`)
        .header('content-length', range.end - range.start + 1)
        .send(openRead(full, { start: range.start, end: range.end }));
    }
    return reply.header('content-length', row.size).send(openRead(full));
  });
};
