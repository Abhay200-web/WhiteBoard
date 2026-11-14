import { canMoveTask, type Task, type TaskStatus } from '@whiteboard/core';
import { cn } from '@whiteboard/ui';
import { useState, type DragEvent } from 'react';

import { TaskMeta } from './TaskMeta';

/** Gap between sort keys, as on the Host, so a card can later go between two others. */
const STEP = 1000;

const bySortKey = (a: Task, b: Task) => a.sortKey - b.sortKey;

/** Sort key that puts a card before `target` in `column`, or at its end without a target. */
function sortKeyFor(column: Task[], target: Task | undefined): number {
  if (!target) return (column.at(-1)?.sortKey ?? 0) + STEP;
  const prev = column[column.indexOf(target) - 1];
  return prev ? Math.floor((prev.sortKey + target.sortKey) / 2) : target.sortKey - STEP;
}

/**
 * Kanban: one column per status. Drag a card to another column to change its status, or onto a
 * card to put it before that one. Only columns the rules allow light up and accept the drop;
 * the drawer's Status menu (open a card) is the keyboard way to move a task.
 */
export function TaskBoard({
  tasks,
  statuses,
  canManage,
  userId,
  onOpen,
  onMove,
}: {
  tasks: Task[];
  statuses: TaskStatus[];
  canManage: boolean;
  userId: string | undefined;
  onOpen: (task: Task) => void;
  onMove: (task: Task, statusId: string, sortKey: number) => void;
}) {
  const [dragging, setDragging] = useState<Task | null>(null);
  const from = statuses.find((s) => s.id === dragging?.statusId);
  const accepts = (status: TaskStatus) => !!from && canMoveTask(from.kind, status.kind, canManage);
  const canDrag = (task: Task) => canManage || task.assignees.some((a) => a.userId === userId);

  function drop(event: DragEvent, status: TaskStatus, target?: Task) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(null);
    if (!dragging || !accepts(status) || target?.id === dragging.id) return;
    const column = tasks
      .filter((t) => t.statusId === status.id && t.id !== dragging.id)
      .sort(bySortKey);
    onMove(dragging, status.id, sortKeyFor(column, target));
  }

  return (
    // A grid, not a side-scrolling strip: every column stays on screen, so a card can always
    // be dragged to any status (dragging into a column scrolled out of view does not work).
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      {statuses.map((status) => {
        const column = tasks.filter((t) => t.statusId === status.id).sort(bySortKey);
        return (
          <section
            key={status.id}
            aria-label={status.name}
            className={cn(
              'flex min-h-24 flex-col gap-2 rounded-md bg-surface-2 p-2',
              dragging && (accepts(status) ? 'ring-2 ring-accent' : 'opacity-50'),
            )}
            onDragOver={(e) => {
              if (accepts(status)) e.preventDefault(); // allows the drop
            }}
            onDrop={(e) => drop(e, status)}
          >
            <h3 className="px-1 text-sm font-medium text-muted">
              {status.name} ({column.length})
            </h3>
            {column.map((task) => (
              <article
                key={task.id}
                draggable={canDrag(task)}
                onDragStart={(e) => {
                  e.dataTransfer?.setData('text/plain', task.id);
                  setDragging(task);
                }}
                onDragEnd={() => setDragging(null)}
                onDrop={(e) => drop(e, status, task)}
                className={cn(
                  'flex flex-col gap-1 rounded-md border border-line bg-surface p-2 text-xs',
                  canDrag(task) && 'cursor-grab',
                )}
              >
                <button
                  type="button"
                  className="text-left text-sm font-medium text-accent underline"
                  onClick={() => onOpen(task)}
                >
                  {task.title}
                </button>
                <div className="flex flex-wrap gap-x-2">
                  <TaskMeta task={task} />
                </div>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}
