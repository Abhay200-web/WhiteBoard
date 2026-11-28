import { randomUUID } from 'node:crypto';

import { BUILT_IN_TEMPLATE_PREFIX, templateCardSchema, type TemplateCard } from '@whiteboard/core';
import { boardTemplates, boardUpdates, type Db } from '@whiteboard/db';
import { and, eq } from 'drizzle-orm';
import * as Y from 'yjs';

import type { AuthContext } from '../auth/sessions';
import { indexCards } from '../search/cardIndex';

const COLUMN = { width: 260, height: 320 };
const NOTE = { width: 220, height: 140 };
const GAP = 40;

/** Columns side by side, each with its title. */
function columns(titles: string[]): TemplateCard[] {
  return titles.map((title, i) => ({
    id: `c${i}`,
    kind: 'column',
    title,
    x: i * (COLUMN.width + GAP),
    y: 0,
    ...COLUMN,
  }));
}

/** A note placed below a row of columns. */
const hint = (text: string): TemplateCard => ({
  id: 'hint',
  kind: 'note',
  text,
  x: 0,
  y: COLUMN.height + GAP,
  ...NOTE,
});

/** Notes in a grid of two across. */
function notes(texts: string[]): TemplateCard[] {
  return texts.map((text, i) => ({
    id: `n${i}`,
    kind: 'note',
    text,
    x: (i % 2) * (NOTE.width + GAP),
    y: Math.floor(i / 2) * (NOTE.height + GAP),
    ...NOTE,
  }));
}

/** Templates every studio has. Their ids never change, so a saved choice keeps working. */
export const BUILT_IN_TEMPLATES: { id: string; name: string; cards: TemplateCard[] }[] = [
  {
    id: `${BUILT_IN_TEMPLATE_PREFIX}task-flow`,
    name: 'Task flow',
    cards: [
      ...columns(['To do', 'In progress', 'Done']),
      hint('Move notes from column to column as the work goes on.'),
    ],
  },
  {
    id: `${BUILT_IN_TEMPLATE_PREFIX}moodboard`,
    name: 'Moodboard',
    cards: [
      ...columns(['Colours', 'Type', 'References']),
      hint('Add pictures and links to each column.'),
    ],
  },
  {
    id: `${BUILT_IN_TEMPLATE_PREFIX}brief`,
    name: 'Brief',
    cards: notes([
      'Goal: what should this work change?',
      'Audience: who is it for?',
      'Deliverables: what do we hand over?',
      'Dates: when is each part due?',
    ]),
  },
  {
    id: `${BUILT_IN_TEMPLATE_PREFIX}retrospective`,
    name: 'Retrospective',
    cards: columns(['Went well', 'To improve', 'Next steps']),
  },
];

/**
 * The cards of a template the caller may use, or `null` if there is none. Freelancers only get
 * the built-in ones: saved templates may hold another project's notes.
 */
export function findTemplateCards(
  db: Db,
  auth: AuthContext,
  templateId: string,
): TemplateCard[] | null {
  const builtIn = BUILT_IN_TEMPLATES.find((t) => t.id === templateId);
  if (builtIn) return builtIn.cards;
  if (auth.user.role === 'guest') return null;
  const row = db
    .select({ cards: boardTemplates.cards })
    .from(boardTemplates)
    .where(and(eq(boardTemplates.id, templateId), eq(boardTemplates.workspaceId, auth.workspaceId)))
    .get();
  if (!row) return null;
  const parsed = templateCardSchema.array().safeParse(row.cards);
  return parsed.success ? parsed.data : [];
}

/**
 * Gives a new board its first cards: one stored update of its live document, so the board opens
 * with them. Every card gets a new id. The cards are added to search straight away.
 */
export function seedBoard(db: Db, boardId: string, cards: readonly TemplateCard[]) {
  if (cards.length === 0) return;
  const doc = new Y.Doc();
  const map = doc.getMap<Y.Map<unknown>>('cards');
  doc.transact(() => {
    for (const card of cards) {
      const entry = new Y.Map<unknown>();
      const id = randomUUID();
      map.set(id, entry);
      for (const [key, value] of Object.entries({ ...card, id })) entry.set(key, value);
    }
  });
  db.insert(boardUpdates)
    .values({ boardId, data: Buffer.from(Y.encodeStateAsUpdate(doc)), createdAt: new Date() })
    .run();
  indexCards(db, boardId, doc);
  doc.destroy();
}
