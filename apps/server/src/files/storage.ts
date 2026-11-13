import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';

/** What we accept, by detected content type. Everything else (exe, scripts, SVG, ...) is refused. */
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/tiff',
  'application/pdf',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/** Plain-text files have no signature, so they are accepted by extension + UTF-8 check. */
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json']);

const THUMBNAIL_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);
const THUMBNAIL_SIZE = 320;

export class UnsupportedFileError extends Error {}

export interface StoredFile {
  id: string;
  mimeType: string;
  size: number;
  sha256: string;
  storagePath: string;
  thumbnailPath: string | null;
}

export function filesRoot(dataDir: string): string {
  return path.join(dataDir, 'files');
}

/** Resolves a relative storage path and refuses anything that escapes the files folder. */
export function resolveStoragePath(dataDir: string, relative: string): string {
  const root = filesRoot(dataDir);
  const full = path.resolve(root, relative);
  if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage path');
  return full;
}

async function looksLikeText(file: string): Promise<boolean> {
  const handle = await open(file, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const sample = buf.subarray(0, bytesRead);
    if (sample.includes(0)) return false;
    // A multi-byte character may be cut at the end of the sample; trim up to 3 bytes.
    for (let cut = 0; cut <= 3 && cut <= sample.length; cut++) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, sample.length - cut));
        return true;
      } catch {
        // try a shorter sample
      }
    }
    return false;
  } finally {
    await handle.close();
  }
}

/** Detects the real content type; throws `UnsupportedFileError` if it is not allowed. */
export async function detectMime(file: string, originalName: string): Promise<string> {
  const detected = await fileTypeFromFile(file);
  if (detected) {
    if (!ALLOWED_MIME.has(detected.mime)) {
      throw new UnsupportedFileError(`This file type (${detected.mime}) is not allowed`);
    }
    return detected.mime;
  }
  const ext = path.extname(originalName).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext) && (await looksLikeText(file))) {
    return ext === '.json' ? 'application/json' : ext === '.csv' ? 'text/csv' : 'text/plain';
  }
  throw new UnsupportedFileError('This file type is not allowed');
}

/**
 * Streams `source` to a temp file while hashing it, checks the content, then moves it into
 * `<dataDir>/files/<ab>/<id>`. Nothing is left behind on failure.
 */
export async function storeUpload(
  dataDir: string,
  source: NodeJS.ReadableStream,
  originalName: string,
): Promise<StoredFile> {
  const root = filesRoot(dataDir);
  const tmpDir = path.join(root, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const id = randomUUID();
  const tmpFile = path.join(tmpDir, id);

  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      size += chunk.length;
      cb(null, chunk);
    },
  });

  try {
    await pipeline(source, meter, createWriteStream(tmpFile));
    if (size === 0) throw new UnsupportedFileError('The file is empty');
    const mimeType = await detectMime(tmpFile, originalName);

    const storagePath = path.join(id.slice(0, 2), id);
    const finalPath = path.join(root, storagePath);
    await mkdir(path.dirname(finalPath), { recursive: true });
    await rename(tmpFile, finalPath);

    let thumbnailPath: string | null = null;
    if (THUMBNAIL_MIME.has(mimeType)) {
      const relative = path.join(id.slice(0, 2), `${id}.thumb.webp`);
      try {
        await sharp(finalPath)
          .rotate()
          .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toFile(path.join(root, relative));
        thumbnailPath = relative;
      } catch {
        // A thumbnail is a convenience; a file sharp cannot decode is still stored.
        await rm(path.join(root, relative), { force: true });
      }
    }
    return { id, mimeType, size, sha256: hash.digest('hex'), storagePath, thumbnailPath };
  } catch (err) {
    await rm(tmpFile, { force: true });
    throw err;
  }
}

export async function removeStored(
  dataDir: string,
  ...relatives: (string | null)[]
): Promise<void> {
  for (const relative of relatives) {
    if (relative) await rm(resolveStoragePath(dataDir, relative), { force: true });
  }
}

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Parses a single `Range: bytes=...` header. Returns `null` when absent/unsupported (serve the
 * whole file) and `'invalid'` when it cannot be satisfied (reply 416).
 */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null; // multi-range or junk: ignore and send everything
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return 'invalid';
  let start: number;
  let end: number;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (suffix === 0) return 'invalid';
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

export async function fileExists(full: string): Promise<boolean> {
  try {
    return (await stat(full)).isFile();
  } catch {
    return false;
  }
}

export const openRead = createReadStream;
