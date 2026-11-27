import { describe, expect, it } from 'vitest';

import { hitTest, itemsInRect, type CanvasItem } from './index';
import { visibleRect, type Viewport } from './viewport';

// Step B1 target: 60 fps with 500 cards. One frame has about 16 ms, so the per-frame work
// (find what is on screen, and hit-test a click) must stay well under that. The budget here
// is generous so a slow CI machine does not flake; the real number is printed below.

function board(count: number): CanvasItem[] {
  const items: CanvasItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      id: `item-${i}`,
      x: (i % 25) * 240,
      y: Math.floor(i / 25) * 180,
      width: 200,
      height: 140,
    });
  }
  return items;
}

describe('performance with 500 cards', () => {
  it('finds the visible cards and hit-tests a click within a frame budget', () => {
    const items = board(500);
    const view: Viewport = { x: 0, y: 0, zoom: 0.5 };
    const size = { width: 1600, height: 900 };

    const frames = 200;
    const started = performance.now();
    let found = 0;
    for (let f = 0; f < frames; f++) {
      const visible = itemsInRect(items, visibleRect(view, size));
      found += visible.length;
      hitTest(visible, { x: 300 + f, y: 200 });
    }
    const perFrame = (performance.now() - started) / frames;

    console.log(
      `[canvas] ${perFrame.toFixed(3)} ms per frame (500 cards, ${found / frames} visible)`,
    );
    expect(perFrame).toBeLessThan(8);
  });
});
