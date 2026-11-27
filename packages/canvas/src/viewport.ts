import type { Point, Rect, Size } from './geometry';

/**
 * What the screen shows. `x` and `y` are the board point at the screen's top-left corner, and
 * `zoom` is screen pixels per board unit (1 = actual size).
 */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function screenToBoard(v: Viewport, p: Point): Point {
  return { x: v.x + p.x / v.zoom, y: v.y + p.y / v.zoom };
}

export function boardToScreen(v: Viewport, p: Point): Point {
  return { x: (p.x - v.x) * v.zoom, y: (p.y - v.y) * v.zoom };
}

/** Moves the view by a drag of `dx`, `dy` screen pixels (the board follows the pointer). */
export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, x: v.x - dx / v.zoom, y: v.y - dy / v.zoom };
}

/** Zooms by `factor`, keeping the board point under `screenPoint` where it is on screen. */
export function zoomAt(v: Viewport, screenPoint: Point, factor: number): Viewport {
  const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const under = screenToBoard(v, screenPoint);
  return { zoom, x: under.x - screenPoint.x / zoom, y: under.y - screenPoint.y / zoom };
}

/** The view that shows `rect` centred, with `padding` screen pixels around it. */
export function fitRect(rect: Rect, size: Size, padding = 40): Viewport {
  const fitX = (size.width - 2 * padding) / Math.max(rect.width, 1);
  const fitY = (size.height - 2 * padding) / Math.max(rect.height, 1);
  const zoom = clamp(Math.min(fitX, fitY), MIN_ZOOM, MAX_ZOOM);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { zoom, x: cx - size.width / (2 * zoom), y: cy - size.height / (2 * zoom) };
}

/** The part of the board the screen currently shows. */
export function visibleRect(v: Viewport, size: Size): Rect {
  return { x: v.x, y: v.y, width: size.width / v.zoom, height: size.height / v.zoom };
}
