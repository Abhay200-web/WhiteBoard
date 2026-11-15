import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** How long a file link works: long enough to watch a video, short enough that a copy soon dies. */
export const LINK_TTL_MS = 60 * 60 * 1000;

/**
 * Signs links to one file's content for media tags, which cannot send the sign-in header. The key
 * lives only in memory, so every link also stops working when the Host restarts. Access is checked
 * when a link is made; a link does not notice access removed during its hour.
 */
export function createFileLinks(key: Buffer = randomBytes(32)) {
  const sign = (fileId: string, expires: number) =>
    createHmac('sha256', key).update(`${fileId}:${expires}`).digest('base64url');

  return {
    create(fileId: string) {
      const expiresAt = Date.now() + LINK_TTL_MS;
      return {
        url: `/files/${fileId}/stream?expires=${expiresAt}&sig=${sign(fileId, expiresAt)}`,
        expiresAt,
      };
    },
    /** True for a link this Host made for this file that has not run out. */
    verify(fileId: string, expires: unknown, sig: unknown): boolean {
      const expiresAt = Number(expires);
      const now = Date.now();
      if (typeof sig !== 'string' || !Number.isSafeInteger(expiresAt)) return false;
      if (expiresAt < now || expiresAt > now + LINK_TTL_MS) return false;
      const expected = Buffer.from(sign(fileId, expiresAt));
      const given = Buffer.from(sig);
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
  };
}
