import { cardSchema, type Card } from '@whiteboard/core';
import { boards, type Db } from '@whiteboard/db';
import { eq, sql } from 'drizzle-orm';
import type * as Y from 'yjs';

/** The words a card contributes to search: its title (or name) and its body text. */
export function cardWords(card: Card): { title: string; body: string } | null {
  switch (card.kind) {
    case 'note':
      return { title: '', body: card.text };
    case 'column':
      return { title: card.title, body: '' };
    case 'link':
      return { title: card.title || card.url, body: card.description };
    case 'image':
    case 'file':
      return { title: card.name, body: '' };
    case 'line':
    case 'task': // a task is found by its own row
      return null;
  }
}

/**
 * Replaces a board's card rows in the search index with the cards in its live document. Called
 * when the document is stored, so search follows what is on the board.
 */
export function indexCards(db: Db, boardId: string, document: Y.Doc) {
  const board = db
    .select({ projectId: boards.projectId })
    .from(boards)
    .where(eq(boards.id, boardId))
    .get();
  if (!board) return;
  const cards: Card[] = [];
  for (const entry of document.getMap('cards').values()) {
    const parsed = cardSchema.safeParse((entry as Y.Map<unknown>).toJSON());
    if (parsed.success) cards.push(parsed.data);
  }
  db.transaction((tx) => {
    tx.run(sql`DELETE FROM search_index WHERE kind = 'card' AND ref_id LIKE ${`${boardId}/%`}`);
    for (const card of cards) {
      const words = cardWords(card);
      if (!words || (!words.title && !words.body)) continue;
      tx.run(sql`INSERT INTO search_index (kind, ref_id, project_id, title, body)
        VALUES ('card', ${`${boardId}/${card.id}`}, ${board.projectId}, ${words.title}, ${words.body})`);
    }
  });
}
