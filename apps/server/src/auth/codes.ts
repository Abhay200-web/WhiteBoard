import { createHash, randomInt } from 'node:crypto';

// No 0/O/1/I/L: codes are read aloud and typed by hand.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomString(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Invite code like `K7QX-M2PD-9WTA` (12 symbols, ~60 bits). */
export function generateInviteCode(): string {
  const raw = randomString(12);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

/** Temporary password handed to a member after an admin reset. */
export function generateTemporaryPassword(): string {
  const raw = randomString(16);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12)}`;
}

/** Codes are matched case-insensitively and ignore dashes and spaces. */
export function hashInviteCode(code: string): string {
  const normalised = code.toUpperCase().replace(/[\s-]/g, '');
  return createHash('sha256').update(normalised).digest('hex');
}
