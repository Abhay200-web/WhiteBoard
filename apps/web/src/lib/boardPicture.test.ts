import type { Card } from '@whiteboard/core';
import { describe, expect, it } from 'vitest';

import {
  drawBoard,
  pictureBounds,
  pictureScale,
  wrapLines,
  type PictureInput,
} from './boardPicture';

/** A stand-in for a canvas: every call is recorded, text is 7 units per character. */
function fakeContext() {
  const calls: { name: string; args: unknown[] }[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, name: string) {
        if (name === 'measureText') return (s: string) => ({ width: s.length * 7 });
        return (...args: unknown[]) => calls.push({ name, args });
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  const texts = () => calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
  return { ctx, calls, texts };
}

const place = { x: 0, y: 0, width: 220, height: 140 };

function input(cards: Card[], extra: Partial<PictureInput> = {}): PictureInput {
  return {
    cards,
    boards: [],
    images: new Map(),
    tasks: new Map(),
    statusNames: new Map(),
    ...extra,
  };
}

describe('board picture', () => {
  it('covers every item with a margin, and stays a small blank picture when empty', () => {
    expect(
      pictureBounds([
        { x: 100, y: 50, width: 200, height: 100 },
        { x: -20, y: 300, width: 40, height: 40 },
      ]),
    ).toEqual({ x: -60, y: 10, width: 400, height: 370 });
    expect(pictureBounds([])).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it('draws twice as large unless that passes the browser limit', () => {
    expect(pictureScale({ x: 0, y: 0, width: 1000, height: 500 })).toBe(2);
    expect(pictureScale({ x: 0, y: 0, width: 16000, height: 500 })).toBe(0.5);
  });

  it('wraps words to the width, keeps line breaks and stops at the line limit', () => {
    const measure = (s: string) => s.length;
    expect(wrapLines('one two three\nfour', measure, 8, 10)).toEqual(['one two', 'three', 'four']);
    expect(wrapLines('one two three four', measure, 8, 2)).toEqual(['one two', 'three']);
  });

  it('draws each kind of card with its text, and child boards by title', () => {
    const { ctx, calls, texts } = fakeContext();
    const picture = { width: 440, height: 220 } as unknown as ImageBitmap;
    drawBoard(
      ctx,
      input(
        [
          { ...place, id: 'n', kind: 'note', text: 'Big idea' },
          { ...place, id: 'c', kind: 'column', title: 'Doing', statusId: 's1' },
          { ...place, id: 't', kind: 'task', taskId: 'task1' },
          { ...place, id: 'i', kind: 'image', fileId: 'f1', name: 'logo.png' },
          { ...place, id: 'j', kind: 'image', fileId: 'gone', name: 'missing.png' },
          {
            ...place,
            id: 'l',
            kind: 'link',
            url: 'https://a.test',
            title: '',
            description: 'Mood',
          },
          { ...place, id: 'a', kind: 'line', reversed: false, arrow: true },
        ],
        {
          boards: [{ ...place, title: 'Sketches' }],
          images: new Map([['f1', picture]]),
          tasks: new Map([['task1', { title: 'Poster', status: 'To do' }]]),
          statusNames: new Map([['s1', 'In progress']]),
        },
      ),
      pictureBounds([place]),
      2,
    );
    expect(texts()).toEqual([
      'Big idea',
      'Doing',
      'Tasks dropped here become:',
      'In progress',
      'Poster',
      'To do',
      'missing.png',
      'https://a.test',
      'Mood',
      '▣ Sketches',
    ]);
    // The 440 x 220 picture is fitted into the card (220 x 140) and centred: 220 wide, 110 high.
    expect(calls.find((c) => c.name === 'drawImage')?.args).toEqual([picture, 0, 15, 220, 110]);
    // The arrow head is drawn as a filled shape after the line.
    expect(calls.filter((c) => c.name === 'closePath')).toHaveLength(1);
  });
});
