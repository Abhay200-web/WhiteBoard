import { describe, expect, it } from 'vitest';

import { moveItems, resizeItem } from './edit';
import type { CanvasItem } from './items';

const start: CanvasItem[] = [
  { id: 'a', x: 100, y: 100, width: 200, height: 100 },
  { id: 'b', x: 0, y: 0, width: 50, height: 50 },
];

describe('moveItems', () => {
  it('moves only the selected items, from their start positions', () => {
    const moved = moveItems(start, new Set(['a']), 30, -10);
    expect(moved[0]).toEqual({ id: 'a', x: 130, y: 90, width: 200, height: 100 });
    expect(moved[1]).toBe(start[1]);
  });

  it('snaps to the grid', () => {
    const moved = moveItems(start, new Set(['a']), 33, 7, 10);
    expect(moved[0]).toMatchObject({ x: 130, y: 110 });
  });

  it('gives the same result for a drag in steps as for one move of the same total', () => {
    // A drag is applied from the start positions every frame, so rounding never builds up.
    const selected = new Set(['a']);
    let frame = start;
    for (const total of [15, 30, 45]) {
      frame = moveItems(start, selected, total, total, 10);
    }
    expect(frame).toEqual(moveItems(start, selected, 45, 45, 10));
  });
});

describe('resizeItem', () => {
  const box = start[0]!;

  it('grows from the bottom-right corner, keeping the top-left fixed', () => {
    expect(resizeItem(box, 'se', 20, 10)).toEqual({ ...box, width: 220, height: 110 });
  });

  it('grows from the top-left corner, keeping the bottom-right fixed', () => {
    const r = resizeItem(box, 'nw', -20, -10);
    expect(r).toEqual({ ...box, x: 80, y: 90, width: 220, height: 110 });
    expect(r.x + r.width).toBe(box.x + box.width);
    expect(r.y + r.height).toBe(box.y + box.height);
  });

  it('never shrinks below the minimum size, and the fixed edge stays put', () => {
    const r = resizeItem(box, 'se', -1000, -1000, 16);
    expect(r).toMatchObject({ x: 100, y: 100, width: 16, height: 16 });
    const l = resizeItem(box, 'nw', 1000, 1000, 16);
    expect(l.x + l.width).toBe(box.x + box.width);
    expect(l.y + l.height).toBe(box.y + box.height);
    expect(l.width).toBe(16);
  });

  it('snaps the moved edge to the grid', () => {
    expect(resizeItem(box, 'se', 23, 0, 16, 10)).toMatchObject({ width: 220 });
  });
});
