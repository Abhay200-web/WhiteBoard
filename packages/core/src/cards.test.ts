import { describe, expect, it } from 'vitest';

import { cardSchema } from './cards';

const place = { id: 'c1', x: 0, y: 0, width: 100, height: 50 };

describe('card shapes', () => {
  it('accepts a column and a line', () => {
    expect(cardSchema.safeParse({ ...place, kind: 'column', title: 'Ideas' }).success).toBe(true);
    expect(
      cardSchema.safeParse({ ...place, kind: 'line', reversed: true, arrow: true }).success,
    ).toBe(true);
  });

  it('accepts a task card, and a column linked to a status or not', () => {
    expect(cardSchema.safeParse({ ...place, kind: 'task', taskId: 't1' }).success).toBe(true);
    expect(
      cardSchema.safeParse({ ...place, kind: 'column', title: 'Doing', statusId: 's2' }).success,
    ).toBe(true);
    expect(cardSchema.safeParse({ ...place, kind: 'column', title: 'Plain' }).success).toBe(true);
  });

  it('refuses a line without its direction flags', () => {
    expect(cardSchema.safeParse({ ...place, kind: 'line' }).success).toBe(false);
  });
});
