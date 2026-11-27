import { describe, expect, it } from 'vitest';

import { snap } from './edit';
import { hitTest, itemsInRect, type CanvasItem } from './items';
import { selectIds } from './selection';

const a: CanvasItem = { id: 'a', x: 0, y: 0, width: 100, height: 100 };
const b: CanvasItem = { id: 'b', x: 50, y: 50, width: 100, height: 100 };

describe('hit testing', () => {
  it('returns the top-most item under the point', () => {
    // b is later in the array, so it sits on top where the two overlap.
    expect(hitTest([a, b], { x: 60, y: 60 })?.id).toBe('b');
    expect(hitTest([a, b], { x: 10, y: 10 })?.id).toBe('a');
  });

  it('returns null on empty board space', () => {
    expect(hitTest([a, b], { x: 500, y: 500 })).toBeNull();
  });
});

describe('items in an area', () => {
  it('finds items that overlap the area, not ones that only touch its edge', () => {
    expect(itemsInRect([a, b], { x: 90, y: 90, width: 5, height: 5 }).map((i) => i.id)).toEqual([
      'a',
      'b',
    ]);
    // a ends at x = 100, so an area starting at 100 only touches it.
    expect(itemsInRect([a], { x: 100, y: 0, width: 10, height: 10 })).toEqual([]);
  });
});

describe('selection', () => {
  it('replaces, adds and toggles', () => {
    const none = new Set<string>();
    const one = selectIds(none, ['a'], 'replace');
    expect([...one]).toEqual(['a']);
    expect([...selectIds(one, ['b'], 'add')].sort()).toEqual(['a', 'b']);
    expect([...selectIds(one, ['a'], 'toggle')]).toEqual([]);
    expect([...selectIds(one, ['b'], 'replace')]).toEqual(['b']);
  });
});

describe('snap', () => {
  it('rounds to the nearest grid line, or leaves the value when grid is 0', () => {
    expect(snap(13, 10)).toBe(10);
    expect(snap(16, 10)).toBe(20);
    expect(snap(13, 0)).toBe(13);
  });
});
