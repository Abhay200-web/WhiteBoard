import { cardSchema, itemGeometrySchema, type Card, type ItemGeometry } from '@whiteboard/core';
import * as Y from 'yjs';

/**
 * A board's cards and child-board placements, read and written through its live document.
 * Each card is its own Y.Map, so two people changing different fields of one card (say, one
 * moves it while the other edits its text) both keep their change.
 */

const cardsOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>('cards');
const placementsOf = (doc: Y.Doc) => doc.getMap<ItemGeometry>('items');

/** Every card that matches its kind. Anything else in the document is skipped, not shown broken. */
export function readCards(doc: Y.Doc): Card[] {
  const cards: Card[] = [];
  for (const entry of cardsOf(doc).values()) {
    const parsed = cardSchema.safeParse(entry.toJSON());
    if (parsed.success) cards.push(parsed.data);
  }
  return cards;
}

/** Adds a card, or replaces every field of an existing one with the same id. */
export function writeCard(doc: Y.Doc, card: Card): void {
  doc.transact(() => {
    const cards = cardsOf(doc);
    let entry = cards.get(card.id);
    if (!entry) {
      entry = new Y.Map();
      cards.set(card.id, entry);
    }
    for (const [key, value] of Object.entries(card)) entry.set(key, value);
  });
}

/** Changes some fields of a card (a move or a resize sends only the new place). */
export function patchCard(doc: Y.Doc, id: string, patch: Partial<Card>): void {
  doc.transact(() => {
    const entry = cardsOf(doc).get(id);
    if (!entry) return;
    for (const [key, value] of Object.entries(patch)) entry.set(key, value);
  });
}

export function removeCard(doc: Y.Doc, id: string): void {
  doc.transact(() => cardsOf(doc).delete(id));
}

/** Where a child board sits on this board, as the document holds it (null if not there yet). */
export function readPlacement(doc: Y.Doc, placementId: string): ItemGeometry | null {
  const parsed = itemGeometrySchema.safeParse(placementsOf(doc).get(placementId));
  return parsed.success ? parsed.data : null;
}

export function writePlacement(doc: Y.Doc, placementId: string, geometry: ItemGeometry): void {
  doc.transact(() => placementsOf(doc).set(placementId, geometry));
}

/**
 * Undo and redo for this person's own changes to the board: cards and child-board placements.
 * Changes from other people are not undone, and each burst of typing is one step.
 */
export function createUndoManager(doc: Y.Doc): Y.UndoManager {
  return new Y.UndoManager([cardsOf(doc), placementsOf(doc)], { captureTimeout: 500 });
}

/** The field a card's text box edits: a note's text or a column's title. */
export function editField(card: Card, value: string): Partial<Card> | null {
  if (card.kind === 'note') return { text: value };
  if (card.kind === 'column') return { title: value };
  return null;
}

/**
 * The column a point (for example, the middle of a dropped card) is over, if any. The column
 * drawn on top wins. `exclude` is the card being dropped, so it never counts as its own column.
 */
export function columnAt(
  cards: readonly Card[],
  point: { x: number; y: number },
  exclude?: string,
): Extract<Card, { kind: 'column' }> | null {
  let found: Extract<Card, { kind: 'column' }> | null = null;
  for (const card of cards) {
    if (card.kind !== 'column' || card.id === exclude) continue;
    const inside =
      point.x >= card.x &&
      point.x <= card.x + card.width &&
      point.y >= card.y &&
      point.y <= card.y + card.height;
    if (inside) found = card; // later cards are drawn on top
  }
  return found;
}
