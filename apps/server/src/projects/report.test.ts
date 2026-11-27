import { describe, expect, it } from 'vitest';

import { buildReport, type ReportInput } from './report';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 27, 12);

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  statuses: [
    { id: 's-todo', name: 'To do', kind: 'todo', sortKey: 1000 },
    { id: 's-done', name: 'Done', kind: 'done', sortKey: 6000 },
  ],
  tasks: [],
  assignees: [],
  waiting: 0,
  decisions: [],
  ...over,
});

describe('buildReport', () => {
  it('counts progress: done, open, overdue and due within a week', () => {
    const report = buildReport(
      input({
        tasks: [
          { id: 'a', statusId: 's-todo', dueAt: NOW - DAY }, // overdue
          { id: 'b', statusId: 's-todo', dueAt: NOW + 3 * DAY }, // due soon
          { id: 'c', statusId: 's-todo', dueAt: NOW + 30 * DAY }, // later
          { id: 'd', statusId: 's-todo', dueAt: null }, // no date
          { id: 'e', statusId: 's-done', dueAt: NOW - 5 * DAY }, // done, not overdue
        ],
      }),
      NOW,
    );
    expect(report.progress).toEqual({ total: 5, done: 1, open: 4, overdue: 1, dueSoon: 1 });
    expect(report.byStatus).toEqual([
      { statusId: 's-todo', name: 'To do', kind: 'todo', count: 4 },
      { statusId: 's-done', name: 'Done', kind: 'done', count: 1 },
    ]);
  });

  it('gives each person their open and overdue tasks, and counts open tasks nobody has', () => {
    const report = buildReport(
      input({
        tasks: [
          { id: 'a', statusId: 's-todo', dueAt: NOW - DAY },
          { id: 'b', statusId: 's-todo', dueAt: null },
          { id: 'c', statusId: 's-done', dueAt: null },
        ],
        assignees: [
          { taskId: 'a', userId: 'u1', name: 'Mia' },
          { taskId: 'b', userId: 'u1', name: 'Mia' },
          { taskId: 'c', userId: 'u2', name: 'Fred' }, // done: not in the workload
        ],
      }),
      NOW,
    );
    expect(report.workload).toEqual([{ userId: 'u1', name: 'Mia', open: 2, overdue: 1 }]);
    expect(report.unassigned).toBe(0);
  });

  it('counts unassigned open tasks', () => {
    const report = buildReport(
      input({ tasks: [{ id: 'a', statusId: 's-todo', dueAt: null }] }),
      NOW,
    );
    expect(report.unassigned).toBe(1);
  });

  it('reports review turnaround in hours, and what waits for a decision', () => {
    const report = buildReport(
      input({
        waiting: 2,
        decisions: [
          { decision: 'approve', waitMs: 2 * 3_600_000 },
          { decision: 'changes', waitMs: 5 * 3_600_000 },
        ],
      }),
      NOW,
    );
    expect(report.reviews).toEqual({
      waiting: 2,
      approved: 1,
      changesRequested: 1,
      averageHours: 3.5,
    });
  });

  it('has no average turnaround before anything was decided', () => {
    expect(buildReport(input(), NOW).reviews.averageHours).toBeNull();
  });
});
