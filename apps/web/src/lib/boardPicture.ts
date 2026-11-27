import type { Card } from '@whiteboard/core';

/**
 * A board as a PNG picture, drawn from its live document onto a canvas in the browser, so the
 * Host needs no image library. The picture covers every card and child board with a margin
 * around them, in a fixed light palette so it reads the same whichever theme the person uses.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A child board placed on this board. */
export interface PictureBoard extends Rect {
  title: string;
}

export interface PictureTask {
  title: string;
  status: string;
}

export interface PictureInput {
  cards: readonly Card[];
  boards: readonly PictureBoard[];
  /** Pictures for image cards, by file id. A missing one is drawn as its name. */
  images: ReadonlyMap<string, CanvasImageSource & { width: number; height: number }>;
  /** Task cards' details, by task id. A missing one is drawn as "Task". */
  tasks: ReadonlyMap<string, PictureTask>;
  /** Names of the statuses columns are linked to, by status id. */
  statusNames: ReadonlyMap<string, string>;
}

const MARGIN = 40;
/** Browsers refuse canvases much larger than this on a side. */
const MAX_SIDE = 8000;
const PAD = 10;
const LINE_HEIGHT = 18;

const COLOR = {
  background: '#f4f4f5',
  card: '#ffffff',
  column: '#f4f4f5',
  board: '#eef2ff',
  border: '#d4d4d8',
  text: '#18181b',
  muted: '#71717a',
} as const;

const FONT = '13px system-ui, sans-serif';
const BOLD = '600 13px system-ui, sans-serif';
const SMALL = '12px system-ui, sans-serif';

/** The area the picture covers: every item plus a margin. An empty board gives a small blank picture. */
export function pictureBounds(rects: readonly Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 400, height: 300 };
  const left = Math.min(...rects.map((r) => r.x)) - MARGIN;
  const top = Math.min(...rects.map((r) => r.y)) - MARGIN;
  const right = Math.max(...rects.map((r) => r.x + r.width)) + MARGIN;
  const bottom = Math.max(...rects.map((r) => r.y + r.height)) + MARGIN;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Pixels per board unit: twice for a sharp picture, less when that would be too large. */
export function pictureScale(bounds: Rect): number {
  return Math.min(2, MAX_SIDE / Math.max(bounds.width, bounds.height));
}

/** Splits text into lines that fit the width, keeping the writer's own line breaks; at most `max` lines. */
export function wrapLines(
  text: string,
  measure: (s: string) => number,
  maxWidth: number,
  max: number,
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = current ? `${current} ${word}` : word;
      if (current && measure(next) > maxWidth) {
        out.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    out.push(current);
  }
  return out.slice(0, max);
}

type Ctx = CanvasRenderingContext2D;

function textBlock(ctx: Ctx, text: string, r: Rect, top: number, font: string, color: string) {
  ctx.font = font;
  ctx.fillStyle = color;
  const max = Math.max(1, Math.floor((r.height - top - PAD) / LINE_HEIGHT) + 1);
  const lines = wrapLines(text, (s) => ctx.measureText(s).width, r.width - 2 * PAD, max);
  lines.forEach((line, i) => ctx.fillText(line, r.x + PAD, r.y + top + i * LINE_HEIGHT));
  return top + lines.length * LINE_HEIGHT;
}

function box(ctx: Ctx, r: Rect, fill: string, inside: () => void) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.width, r.height, 8);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.save();
  ctx.clip();
  inside();
  ctx.restore();
  ctx.lineWidth = 1;
  ctx.strokeStyle = COLOR.border;
  ctx.stroke();
}

function line(ctx: Ctx, card: Extract<Card, { kind: 'line' }>) {
  const [x1, y1, x2, y2] = card.reversed
    ? [card.x, card.y + card.height, card.x + card.width, card.y]
    : [card.x, card.y, card.x + card.width, card.y + card.height];
  ctx.strokeStyle = COLOR.text;
  ctx.fillStyle = COLOR.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  if (!card.arrow) return;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 10;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(angle - 0.45), y2 - size * Math.sin(angle - 0.45));
  ctx.lineTo(x2 - size * Math.cos(angle + 0.45), y2 - size * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
}

function card(ctx: Ctx, c: Card, input: PictureInput) {
  ctx.textBaseline = 'top';
  switch (c.kind) {
    case 'line':
      return line(ctx, c);
    case 'note':
      return box(ctx, c, COLOR.card, () => textBlock(ctx, c.text, c, PAD, FONT, COLOR.text));
    case 'column':
      return box(ctx, c, COLOR.column, () => {
        textBlock(ctx, c.title || 'Untitled column', { ...c, height: 34 }, PAD, BOLD, COLOR.text);
        ctx.fillStyle = COLOR.border;
        ctx.fillRect(c.x, c.y + 34, c.width, 1);
        const status = c.statusId ? input.statusNames.get(c.statusId) : undefined;
        if (status)
          textBlock(ctx, `Tasks dropped here become: ${status}`, c, 44, SMALL, COLOR.muted);
      });
    case 'task':
      return box(ctx, c, COLOR.card, () => {
        const task = input.tasks.get(c.taskId);
        const next = textBlock(
          ctx,
          task?.title ?? 'Task',
          { ...c, height: 46 },
          PAD,
          BOLD,
          COLOR.text,
        );
        if (task?.status) textBlock(ctx, task.status, c, next + 2, SMALL, COLOR.muted);
      });
    case 'image':
      return box(ctx, c, COLOR.card, () => {
        const picture = input.images.get(c.fileId);
        if (!picture) return void textBlock(ctx, c.name, c, PAD, FONT, COLOR.muted);
        // Fit the whole picture in the card, centred, as the board does.
        const fit = Math.min(c.width / picture.width, c.height / picture.height);
        const w = picture.width * fit;
        const h = picture.height * fit;
        ctx.drawImage(picture, c.x + (c.width - w) / 2, c.y + (c.height - h) / 2, w, h);
      });
    case 'file':
      return box(ctx, c, COLOR.card, () => {
        const next = textBlock(ctx, c.name, { ...c, height: 46 }, PAD, BOLD, COLOR.text);
        textBlock(ctx, c.mimeType, c, next + 2, SMALL, COLOR.muted);
      });
    case 'link':
      return box(ctx, c, COLOR.card, () => {
        const next = textBlock(ctx, c.title || c.url, { ...c, height: 46 }, PAD, BOLD, COLOR.text);
        if (c.description) textBlock(ctx, c.description, c, next + 2, FONT, COLOR.muted);
      });
  }
}

/** Draws the board onto a canvas sized `bounds` times `scale`, in the same order as the screen. */
export function drawBoard(ctx: Ctx, input: PictureInput, bounds: Rect, scale: number): void {
  ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
  ctx.fillStyle = COLOR.background;
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  for (const c of input.cards) card(ctx, c, input);
  for (const b of input.boards) {
    box(ctx, b, COLOR.board, () => {
      ctx.textBaseline = 'top';
      textBlock(ctx, `▣ ${b.title}`, b, PAD, BOLD, COLOR.text);
    });
  }
}

/** The board as a PNG file. */
export async function boardPng(input: PictureInput): Promise<Blob> {
  const bounds = pictureBounds([...input.cards, ...input.boards]);
  const scale = pictureScale(bounds);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(bounds.width * scale);
  canvas.height = Math.ceil(bounds.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot draw pictures');
  drawBoard(ctx, input, bounds, scale);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not make the picture'))),
      'image/png',
    ),
  );
}
