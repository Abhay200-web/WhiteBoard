import { z } from 'zod';

/** What a search hit is: a project, a task, a task comment, a board, or a card on a board. */
export const SEARCH_KINDS = ['project', 'task', 'comment', 'board', 'card'] as const;

export const searchHitSchema = z.object({
  kind: z.enum(SEARCH_KINDS),
  /** The project, task, comment, board or card id. */
  id: z.string(),
  projectId: z.string(),
  /** For a card: the board it sits on. For a board: itself. Otherwise null. */
  boardId: z.string().nullable(),
  /** The project's or board's name, the task's title (for a comment, its task), or the card's title. */
  title: z.string(),
  /** A few words around the match, with the match in [brackets]. */
  snippet: z.string(),
});
export type SearchHit = z.infer<typeof searchHitSchema>;
export const searchResultSchema = z.array(searchHitSchema);
