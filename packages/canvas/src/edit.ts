import type { CanvasItem } from './items';

/**
 * Editing helpers. A drag passes the item positions from when the drag began, and the total
 * move so far, so a long drag never accumulates rounding.
 */

/** Rounds to the nearest grid line; `grid` of 0 turns snapping off. */
export function snap(value: number, grid: number): number {
  return grid > 0 ? Math.round(value / grid) * grid : value;
}

/** Items in `selected` moved by (dx, dy) from `start`; other items are returned as they are. */
export function moveItems(
  start: readonly CanvasItem[],
  selected: ReadonlySet<string>,
  dx: number,
  dy: number,
  grid = 0,
): CanvasItem[] {
  return start.map((item) =>
    selected.has(item.id)
      ? { ...item, x: snap(item.x + dx, grid), y: snap(item.y + dy, grid) }
      : item,
  );
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * One item resized by dragging `corner` by (dx, dy) from its start size. The opposite corner
 * stays where it is, and the size never goes below `minSize`.
 */
export function resizeItem(
  start: CanvasItem,
  corner: Corner,
  dx: number,
  dy: number,
  minSize = 16,
  grid = 0,
): CanvasItem {
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';

  let left = start.x;
  let right = start.x + start.width;
  let top = start.y;
  let bottom = start.y + start.height;

  // Move the dragged edges, then keep the fixed edge at least minSize away.
  if (west) left = snap(left + dx, grid);
  else right = snap(right + dx, grid);
  if (north) top = snap(top + dy, grid);
  else bottom = snap(bottom + dy, grid);

  if (west) left = Math.min(left, right - minSize);
  else right = Math.max(right, left + minSize);
  if (north) top = Math.min(top, bottom - minSize);
  else bottom = Math.max(bottom, top + minSize);

  return { ...start, x: left, y: top, width: right - left, height: bottom - top };
}
