import { memberships, type Db } from '@whiteboard/db';
import { and, eq, isNull, lte } from 'drizzle-orm';

import { revokeAllSessions } from '../auth/sessions';
import type { EventHub } from '../events/hub';
import { announceHandOver, handOverTasks } from '../projects/offboarding';
import type { Job } from '../scheduler';

/**
 * Removes guests (freelancers) whose end date has passed and signs them out. Their open tasks
 * become unassigned and each project's managers are told, as when an admin removes someone.
 */
export function expireGuests(db: Db, hub: EventHub, now: Date): string[] {
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
    const touched = db.transaction((tx) => {
      const handed = handOverTasks(tx, hub, {
        userId,
        actorId: userId,
        reassign: new Map(),
        auto: true,
      });
      tx.update(memberships)
        .set({ removedAt: now })
        .where(and(eq(memberships.userId, userId), isNull(memberships.removedAt)))
        .run();
      return handed;
    });
    revokeAllSessions(db, userId);
    announceHandOver(db, hub, touched);
  }
  return expired.map((e) => e.userId);
}

/** Daily. Needs the Host's hub so managers' open apps hear about it at once. */
export const guestExpiryJob = (hub: EventHub): Job => ({
  name: 'guest-expiry',
  intervalMs: 24 * 60 * 60 * 1000,
  run: (db, now) => {
    expireGuests(db, hub, now);
  },
});
