import { type Task } from '@whiteboard/core';
import { Button, cn } from '@whiteboard/ui';
import { useState } from 'react';

import { dayKey, monthWeeks, tasksByDay } from './calendar';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Tasks on the day they are due, a month at a time. Tasks without a due date are not shown
 * here; the note under the grid counts them.
 */
export function TaskCalendar({ tasks, onOpen }: { tasks: Task[]; onOpen: (task: Task) => void }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const weeks = monthWeeks(cursor.year, cursor.month);
  const byDay = tasksByDay(tasks);
  const undated = tasks.filter((t) => t.dueAt === null).length;
  const todayKey = dayKey(today);
  const monthTitle = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const shift = (months: number) =>
    setCursor((c) => {
      const d = new Date(c.year, c.month + months, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" aria-label="Previous month" onClick={() => shift(-1)}>
            ‹
          </Button>
          <Button
            variant="ghost"
            onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
          >
            Today
          </Button>
          <Button variant="ghost" aria-label="Next month" onClick={() => shift(1)}>
            ›
          </Button>
        </div>
        <h3 className="text-sm font-medium">{monthTitle}</h3>
      </div>

      <div className="grid grid-cols-7 gap-px rounded-md border border-line bg-line text-sm">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-surface px-2 py-1 text-xs font-medium text-muted">
            {d}
          </div>
        ))}
        {weeks.flat().map((day) => {
          const key = dayKey(day);
          const inMonth = day.getMonth() === cursor.month;
          return (
            <div
              key={key}
              className={cn(
                'min-h-24 bg-surface p-1',
                !inMonth && 'text-muted',
                key === todayKey && 'ring-1 ring-inset ring-accent',
              )}
            >
              <div className="text-xs">{day.getDate()}</div>
              <ul className="mt-1 space-y-1">
                {(byDay.get(key) ?? []).map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="w-full truncate rounded px-1 text-left text-xs text-accent underline"
                      onClick={() => onOpen(t)}
                    >
                      {t.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {undated > 0 && (
        <p className="mt-2 text-xs text-muted">
          {undated} without a due date {undated === 1 ? 'is' : 'are'} not shown.
        </p>
      )}
    </div>
  );
}
