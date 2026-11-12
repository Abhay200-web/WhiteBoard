import { memberships, type Db } from '@whiteboard/db';
import { and, eq, isNull, lte } from 'drizzle-orm';

import { revokeAllSessions } from '../auth/sessions';
import type { Job } from '../scheduler';

/** Removes guests (freelancers) whose end date has passed and signs them out. */
export function expireGuests(db: Db, now: Date): string[] {
  const expired = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.role, 'guest'),
        isNull(memberships.removedAt),
        lte(memberships.expiresAt, now),
      ),
    )
    .all();
  for (const { userId } of expired) {
    db.update(memberships)
      .set({ removedAt: now })
      .where(and(eq(memberships.userId, userId), isNull(memberships.removedAt)))
      .run();
    revokeAllSessions(db, userId);
  }
  return expired.map((e) => e.userId);
}

export const guestExpiryJob: Job = {
  name: 'guest-expiry',
  intervalMs: 24 * 60 * 60 * 1000,
  run: (db, now) => {
    expireGuests(db, now);
  },
};
