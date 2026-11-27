import { describe, expect, it } from 'vitest';

import {
  boardToScreen,
  fitRect,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  screenToBoard,
  visibleRect,
  zoomAt,
} from './viewport';

describe('viewport', () => {
  it('converts between screen and board points', () => {
    const v = { x: 100, y: 50, zoom: 2 };
    expect(screenToBoard(v, { x: 0, y: 0 })).toEqual({ x: 100, y: 50 });
    expect(boardToScreen(v, { x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
    expect(screenToBoard(v, boardToScreen(v, { x: 130, y: 90 }))).toEqual({ x: 130, y: 90 });
  });

  it('pans so the board follows the pointer', () => {
    const v = panBy({ x: 0, y: 0, zoom: 2 }, 20, -10);
    // Dragging right by 20 screen pixels at zoom 2 moves the view 10 board units left.
    expect(v).toEqual({ x: -10, y: 5, zoom: 2 });
  });

  it('zooms around the pointer, keeping the board point under it fixed', () => {
    const v = { x: 0, y: 0, zoom: 1 };
    const point = { x: 300, y: 200 };
    const before = screenToBoard(v, point);
    const zoomed = zoomAt(v, point, 2);
    expect(zoomed.zoom).toBe(2);
    expect(screenToBoard(zoomed, point)).toEqual(before);
  });

  it('clamps zoom to the allowed range', () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 1000).zoom).toBe(MAX_ZOOM);
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 0.0001).zoom).toBe(MIN_ZOOM);
  });

  it('fits a rectangle into the screen and centres it', () => {
    const size = { width: 800, height: 600 };
    const v = fitRect({ x: 0, y: 0, width: 400, height: 300 }, size, 0);
    expect(v.zoom).toBe(2);
    // The centre of the rectangle, (200, 150), lands in the middle of the screen.
    expect(boardToScreen(v, { x: 200, y: 150 })).toEqual({ x: 400, y: 300 });
  });

  it('reports the board area the screen shows', () => {
    expect(visibleRect({ x: 10, y: 20, zoom: 2 }, { width: 200, height: 100 })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });
});
