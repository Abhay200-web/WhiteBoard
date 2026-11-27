import { boardItems, boards, type Db } from '@whiteboard/db';
import { eq } from 'drizzle-orm';

import { canViewProject } from '../projects/access';
import type { Actor } from '../projects/access';

export type BoardRow = typeof boards.$inferSelect;

/** The board that `boardId` sits on, or null for a root board. */
export function parentOf(db: Db, boardId: string): BoardRow | null {
  const link = db
    .select({ boardId: boardItems.boardId })
    .from(boardItems)
    .where(eq(boardItems.childBoardId, boardId))
    .get();
  if (!link) return null;
  return db.select().from(boards).where(eq(boards.id, link.boardId)).get() ?? null;
}

/** The chain from the project's root board down to `row` (inclusive). */
export function trailOf(db: Db, row: BoardRow): BoardRow[] {
  const chain: BoardRow[] = [row];
  for (let up = parentOf(db, row.id); up; up = parentOf(db, up.id)) chain.unshift(up);
  return chain;
}

/**
 * A board the actor may view, with its trail, or null. Null for unknown boards, for boards in
 * projects the actor is not on (no probing for ids), for boards in the trash and for boards
 * nested in a trashed board. `includeTrashed` lets restore reach the trashed board itself.
 */
export function findViewableBoard(
  db: Db,
  actor: Actor,
  boardId: string,
  { includeTrashed = false }: { includeTrashed?: boolean } = {},
): { row: BoardRow; chain: BoardRow[] } | null {
  const row = db.select().from(boards).where(eq(boards.id, boardId)).get();
  if (!row || !canViewProject(db, actor, row.projectId)) return null;
  const chain = trailOf(db, row);
  const above = chain.slice(0, -1).some((b) => b.trashedAt);
  if (above || (row.trashedAt && !includeTrashed)) return null;
  return { row, chain };
}
