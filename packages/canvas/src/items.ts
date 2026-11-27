import { containsPoint, intersects, type Point, type Rect } from './geometry';

/** A card on a board. Later items in the array sit on top of earlier ones. */
export interface CanvasItem extends Rect {
  id: string;
}

/** The top-most item under `p`, or null. */
export function hitTest(items: readonly CanvasItem[], p: Point): CanvasItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (containsPoint(items[i]!, p)) return items[i]!;
  }
  return null;
}

/** Items that overlap `area` (touching edges do not count). */
export function itemsInRect(items: readonly CanvasItem[], area: Rect): CanvasItem[] {
  return items.filter((item) => intersects(item, area));
}
