import type { Card } from '@whiteboard/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { createUndoManager, patchCard, readCards, removeCard, writeCard } from './cards';

const note: Card = { id: 'n1', kind: 'note', x: 10, y: 20, width: 200, height: 120, text: 'Hi' };

describe('cards in the live document', () => {
  it('writes, reads back and removes a card', () => {
    const doc = new Y.Doc();
    writeCard(doc, note);
    expect(readCards(doc)).toEqual([note]);
    removeCard(doc, 'n1');
    expect(readCards(doc)).toEqual([]);
  });

  it('moves a card without losing an edit to its text made at the same time', () => {
    const a = new Y.Doc();
    writeCard(a, note);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // One person moves the card while the other edits its text.
    patchCard(a, 'n1', { x: 300, y: 40 });
    patchCard(b, 'n1', { text: 'Edited' });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(readCards(a)[0]).toMatchObject({ x: 300, y: 40, text: 'Edited' });
    expect(readCards(b)).toEqual(readCards(a));
  });

  it('skips a card that does not match its kind instead of showing it broken', () => {
    const doc = new Y.Doc();
    writeCard(doc, note);
    doc.getMap<Y.Map<unknown>>('cards').set('bad', new Y.Map([['kind', 'note']]));
    expect(readCards(doc).map((c) => c.id)).toEqual(['n1']);
  });
});

describe('undo and redo', () => {
  it('undoes and redoes a person’s own card, but not someone else’s change', () => {
    const doc = new Y.Doc();
    const undo = createUndoManager(doc);
    writeCard(doc, note);
    expect(readCards(doc)).toHaveLength(1);
    undo.undo();
    expect(readCards(doc)).toEqual([]);
    undo.redo();
    expect(readCards(doc)).toHaveLength(1);

    // A change made elsewhere arrives with another origin and is not undone here.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    writeCard(other, { ...note, id: 'n2' });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), 'remote');
    undo.undo();
    expect(readCards(doc).map((c) => c.id)).toEqual(['n2']);
  });
});
