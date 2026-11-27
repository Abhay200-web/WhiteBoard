import { searchResultSchema, type SearchHit } from '@whiteboard/core';
import { tasks, type Db } from '@whiteboard/db';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { authenticate, requireRole, ALL_ROLES } from '../plugins/auth';
import { visibleProjectIds } from '../projects/access';

const LIMIT = 50;

/** Turns what the person typed into a full-text query: every word, as a prefix ("logo" finds "logos"). */
export function matchQuery(text: string): string {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .map((word) => `"${word}"*`)
    .join(' ');
}

export const searchRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const signedIn = [authenticate(db), requireRole(ALL_ROLES)];

  /** Search across everything the person can see. Results come only from their projects. */
  app.get('/search', { preHandler: signedIn }, async (request) => {
    const q = String((request.query as { q?: string }).q ?? '');
    const match = matchQuery(q);
    const visible = visibleProjectIds(db, request.auth!);
    if (!match || visible.length === 0) return searchResultSchema.parse([]);

    const rows = db.all<{
      kind: SearchHit['kind'];
      ref_id: string;
      project_id: string;
      title: string;
      snippet: string;
    }>(sql`SELECT kind, ref_id, project_id, title,
        snippet(search_index, 4, '[', ']', '…', 12) AS snippet
      FROM search_index
      WHERE search_index MATCH ${match}
        AND project_id IN (${sql.join(
          visible.map((id) => sql`${id}`),
          sql`, `,
        )})
      ORDER BY rank
      LIMIT ${LIMIT}`);

    // A comment's row keeps its task's id in `title`; show the task's title instead.
    const taskIds = rows.filter((r) => r.kind === 'comment').map((r) => r.title);
    const taskTitles = new Map(
      taskIds.length
        ? db
            .select({ id: tasks.id, title: tasks.title })
            .from(tasks)
            .where(
              sql`${tasks.id} IN (${sql.join(
                taskIds.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            )
            .all()
            .map((t) => [t.id, t.title])
        : [],
    );

    return searchResultSchema.parse(
      rows.map((r) => {
        if (r.kind === 'card') {
          const [boardId, cardId] = r.ref_id.split('/');
          return {
            kind: 'card',
            id: cardId,
            projectId: r.project_id,
            boardId,
            title: r.title,
            snippet: r.snippet,
          };
        }
        if (r.kind === 'board') {
          return {
            kind: 'board',
            id: r.ref_id,
            projectId: r.project_id,
            boardId: r.ref_id,
            title: r.title,
            snippet: r.snippet,
          };
        }
        if (r.kind === 'comment') {
          return {
            kind: 'comment',
            id: r.ref_id,
            projectId: r.project_id,
            boardId: null,
            title: taskTitles.get(r.title) ?? '',
            snippet: r.snippet,
          };
        }
        return {
          kind: r.kind,
          id: r.ref_id,
          projectId: r.project_id,
          boardId: null,
          title: r.title,
          snippet: r.snippet,
        };
      }),
    );
  });
};
