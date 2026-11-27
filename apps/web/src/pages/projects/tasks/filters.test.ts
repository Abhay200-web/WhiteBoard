import type { Task } from '@whiteboard/core';
import { describe, expect, it } from 'vitest';

import { applyTaskFilter, hasTaskFilter } from './filters';
import { dayKey, monthWeeks, tasksByDay } from './calendar';

const task = (id: string, over: Partial<Task> = {}): Task =>
  ({
    id,
    statusId: 's1',
    priority: 'medium',
    dueAt: null,
    assignees: [],
    ...over,
  }) as Task;

describe('applyTaskFilter', () => {
  const tasks = [
    task('a', { statusId: 's1', priority: 'urgent', assignees: [{ userId: 'u1', name: 'A' }] }),
    task('b', { statusId: 's2', priority: 'low' }),
    task('c', { statusId: 's1', priority: 'low', assignees: [{ userId: 'u2', name: 'B' }] }),
  ];
  const ids = (list: Task[]) => list.map((t) => t.id);

  it('keeps everything with an empty filter', () => {
    expect(ids(applyTaskFilter(tasks, {}))).toEqual(['a', 'b', 'c']);
    expect(hasTaskFilter({})).toBe(false);
  });

  it('matches every field that is set', () => {
    expect(ids(applyTaskFilter(tasks, { statusId: 's1' }))).toEqual(['a', 'c']);
    expect(ids(applyTaskFilter(tasks, { priority: 'low' }))).toEqual(['b', 'c']);
    expect(ids(applyTaskFilter(tasks, { assigneeId: 'u2' }))).toEqual(['c']);
    expect(ids(applyTaskFilter(tasks, { statusId: 's1', priority: 'low' }))).toEqual(['c']);
    expect(hasTaskFilter({ assigneeId: 'u2' })).toBe(true);
  });
});

describe('calendar', () => {
  it('lays a month out as full Monday-first weeks', () => {
    // November 2026 starts on a Sunday, so the first row starts on Monday 26 October.
    const weeks = monthWeeks(2026, 10);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(dayKey(weeks[0]![0]!)).toBe('2026-10-26');
    expect(dayKey(weeks[0]![6]!)).toBe('2026-11-01');
    // 30 November is a Monday, so a sixth row holds the start of December.
    expect(weeks).toHaveLength(6);
    expect(dayKey(weeks[5]![0]!)).toBe('2026-11-30');
    expect(dayKey(weeks[5]![6]!)).toBe('2026-12-06');
  });

  it('groups tasks with a due date by day, earliest first, and skips the rest', () => {
    const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();
    const byDay = tasksByDay([
      task('late', { dueAt: at(5, 17) }),
      task('early', { dueAt: at(5, 9) }),
      task('none'),
    ]);
    expect([...byDay.keys()]).toEqual(['2026-11-05']);
    expect(byDay.get('2026-11-05')!.map((t) => t.id)).toEqual(['early', 'late']);
  });
});
