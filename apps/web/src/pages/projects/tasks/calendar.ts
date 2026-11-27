import type { Task } from '@whiteboard/core';

/** The day a timestamp falls on, in this computer's time zone, as "2026-11-27". */
export function dayKey(time: number | Date): string {
  const d = typeof time === 'number' ? new Date(time) : time;
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * The weeks of a month as rows of seven days, Monday first. The first and last weeks include
 * the days of the neighbouring months, so every row is complete.
 */
export function monthWeeks(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // days since Monday
  const start = new Date(year, month, 1 - offset);
  const daysShown = Math.ceil((offset + new Date(year, month + 1, 0).getDate()) / 7) * 7;
  const days = Array.from(
    { length: daysShown },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** Tasks with a due date, grouped by the day it falls on; each day's tasks by due time. */
export function tasksByDay(tasks: Task[]): Map<string, Task[]> {
  const byDay = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.dueAt === null) continue;
    const key = dayKey(task.dueAt);
    byDay.set(key, [...(byDay.get(key) ?? []), task]);
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  return byDay;
}
