import { z } from 'zod';

import {
  columnCardSchema,
  linkCardSchema,
  lineCardSchema,
  noteCardSchema,
  type Card,
} from './cards';

/**
 * A board template: cards a new board starts with. Only cards that mean the same on any project
 * are kept (notes, columns, lines and links). Pictures, files and tasks belong to their project,
 * and a column's link to a task status is dropped, since statuses are per project.
 */
export const templateCardSchema = z.discriminatedUnion('kind', [
  noteCardSchema,
  columnCardSchema.omit({ statusId: true }),
  lineCardSchema,
  linkCardSchema,
]);
export type TemplateCard = z.infer<typeof templateCardSchema>;

/** The cards of a board that a template keeps, ready to store. */
export function templateCards(cards: readonly Card[]): TemplateCard[] {
  const kept: TemplateCard[] = [];
  for (const card of cards) {
    if (card.kind === 'column') {
      const { statusId: _status, ...column } = card;
      kept.push(column);
    } else if (card.kind === 'note' || card.kind === 'line' || card.kind === 'link') {
      kept.push(card);
    }
  }
  return kept;
}

/** Built-in templates have ids starting with this; saved ones have plain ids. */
export const BUILT_IN_TEMPLATE_PREFIX = 'builtin:';

export const boardTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  builtIn: z.boolean(),
  cardCount: z.number().int(),
  /** Who saved it; `null` for built-in templates. */
  createdBy: z.string().nullable(),
  createdByName: z.string().nullable(),
});
export type BoardTemplate = z.infer<typeof boardTemplateSchema>;
export const boardTemplateListSchema = z.array(boardTemplateSchema);

/** At most this many cards in one template. */
export const MAX_TEMPLATE_CARDS = 500;

export const createBoardTemplateRequestSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  cards: z
    .array(templateCardSchema)
    .min(1, 'The board has nothing a template can keep')
    .max(MAX_TEMPLATE_CARDS, `A template holds at most ${MAX_TEMPLATE_CARDS} cards`),
});
export type CreateBoardTemplateRequest = z.infer<typeof createBoardTemplateRequestSchema>;
