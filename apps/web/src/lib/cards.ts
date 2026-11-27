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
