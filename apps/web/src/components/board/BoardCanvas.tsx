import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BoardItem, Card, LinkPreview } from '@whiteboard/core';
import {
  boardToScreen,
  itemsInRect,
  moveItems,
  panBy,
  resizeItem,
  screenToBoard,
  selectIds,
  visibleRect,
  zoomAt,
  type CanvasItem,
  type Corner,
  type Viewport,
} from '@whiteboard/canvas';
import { Button, cn } from '@whiteboard/ui';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { useNavigate } from 'react-router';
import type * as Y from 'yjs';

import { api, errorText } from '../../lib/api';
import { boardPng, type PictureTask } from '../../lib/boardPicture';
import { fetchFileBlob } from '../../lib/files';
import { taskQuery, useStatuses } from '../../pages/projects/tasks/queries';
import { saveBlob } from '../FilePreview';
import { taskSchema, type Task } from '@whiteboard/core';
import {
  columnAt,
  createUndoManager,
  editField,
  patchCard,
  readCards,
  readPlacement,
  removeCard,
  writeCard,
  writePlacement,
} from '../../lib/cards';
import { CardBody } from './CardBody';
import { FilePickDialog, LinkDialog } from './AddDialogs';
import { TaskPickDialog } from './TaskPickDialog';

/** Positions snap to this grid, in board units. */
const GRID = 8;

const SIZE = {
  note: { width: 220, height: 140 },
  image: { width: 240, height: 180 },
  file: { width: 240, height: 88 },
  link: { width: 260, height: 120 },
  column: { width: 260, height: 320 },
  line: { width: 160, height: 80 },
  task: { width: 220, height: 110 },
} as const;

/** How far a duplicate is offset from its original, in board units. */
const DUPLICATE_OFFSET = 24;

/** Changes whenever the live document changes, so the screen can read it again. */
function useDocVersion(doc: Y.Doc): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    doc.on('update', bump);
    return () => void doc.off('update', bump);
  }, [doc]);
  return version;
}

function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

type Drag =
  | { mode: 'pan'; start: { x: number; y: number }; view: Viewport }
  | {
      mode: 'move' | 'resize';
      start: { x: number; y: number };
      base: CanvasItem[];
      ids: Set<string>;
      corner?: Corner;
    };

/** The right-click menu: open at a point on the surface, for one item. */
interface MenuState {
  x: number;
  y: number;
  id: string;
}

/**
 * The board surface: cards and child boards placed on it, panned, zoomed, selected, dragged,
 * resized, edited and undone. Every change is written to the live document, so everyone else sees it.
 */
export function BoardCanvas({
  boardId,
  projectId,
  title,
  doc,
  items,
}: {
  boardId: string;
  projectId: string;
  /** The board's name, for the downloaded picture's file name. */
  title: string;
  doc: Y.Doc;
  items: BoardItem[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const version = useDocVersion(doc);
  const surface = useRef<HTMLDivElement>(null);
  const size = useElementSize(surface);
  // Not destroyed on unmount: development builds run effects twice, which would switch it off.
  // It belongs to the document, so it goes when the document does.
  const undo = useMemo(() => createUndoManager(doc), [doc]);
  // The undo / redo buttons follow the undo history itself, not only the document's changes.
  const [, setHistoryTick] = useState(0);
  useEffect(() => {
    const changed = () => setHistoryTick((t) => t + 1);
    const events = ['stack-item-added', 'stack-item-popped', 'stack-cleared'] as const;
    events.forEach((name) => undo.on(name, changed));
    return () => events.forEach((name) => undo.off(name, changed));
  }, [undo]);

  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState<Map<string, CanvasItem>>(new Map());
  const [dialog, setDialog] = useState<null | 'link' | 'image' | 'file' | 'task'>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const drag = useRef<Drag | null>(null);
  const previewRef = useRef(preview);
  const viewRef = useRef(view);
  viewRef.current = view;

  const cards = useMemo(() => readCards(doc), [doc, version]);
  const placements = useMemo(
    () =>
      items.map((item) => ({
        item,
        geometry: readPlacement(doc, item.id) ?? {
          childBoardId: item.childBoardId,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
        },
      })),
    [doc, items, version],
  );

  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const placementsById = useMemo(
    () => new Map(placements.map((p) => [p.item.id, p])),
    [placements],
  );
  const everything: CanvasItem[] = useMemo(
    () => [
      ...cards.map((c) => ({ id: c.id, x: c.x, y: c.y, width: c.width, height: c.height })),
      ...placements.map((p) => ({ id: p.item.id, ...p.geometry })),
    ],
    [cards, placements],
  );
  const shown = useMemo(
    () => everything.map((shape) => preview.get(shape.id) ?? shape),
    [everything, preview],
  );
  const onScreen = itemsInRect(shown, visibleRect(view, size));

  function setPreviewBoth(next: Map<string, CanvasItem>) {
    previewRef.current = next;
    setPreview(next);
  }

  // Wheel zooms around the pointer. Native listener, so the page itself does not scroll.
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      setView((v) => zoomAt(v, at, e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keys: Delete removes the selected cards; Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName))) {
        return;
      }
      if (e.key === 'Escape') {
        setSelected(new Set());
        setMenu(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) undo.redo();
        else undo.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        undo.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        for (const id of selected) if (cardsById.has(id)) removeCard(doc, id);
        setSelected(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, undo, editing, selected, cardsById]);

  function pointIn(e: { clientX: number; clientY: number }) {
    const rect = surface.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    setMenu(null);
    if (editing || e.button !== 0) return;
    const el = e.target as HTMLElement;
    const handle = el.closest<HTMLElement>('[data-handle]');
    const item = el.closest<HTMLElement>('[data-item]');
    const start = pointIn(e);

    if (handle && selected.size === 1) {
      const ids = new Set(selected);
      drag.current = {
        mode: 'resize',
        start,
        base: everything.filter((s) => ids.has(s.id)),
        ids,
        corner: handle.dataset.handle as Corner,
      };
    } else if (item) {
      const id = item.dataset.item!;
      const next = selected.has(id)
        ? selected
        : selectIds(selected, [id], e.shiftKey ? 'add' : 'replace');
      setSelected(next);
      drag.current = {
        mode: 'move',
        start,
        base: everything.filter((s) => next.has(s.id)),
        ids: new Set(next),
      };
    } else {
      if (!e.shiftKey) setSelected(new Set());
      drag.current = { mode: 'pan', start, view: viewRef.current };
    }
    surface.current!.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const p = pointIn(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (d.mode === 'pan') {
      setView(panBy(d.view, dx, dy));
      return;
    }
    const zoom = viewRef.current.zoom;
    const boardDx = dx / zoom;
    const boardDy = dy / zoom;
    const next = new Map<string, CanvasItem>();
    if (d.mode === 'move') {
      for (const s of moveItems(d.base, d.ids, boardDx, boardDy, GRID)) {
        if (d.ids.has(s.id)) next.set(s.id, s);
      }
    } else {
      const shape = resizeItem(d.base[0]!, d.corner!, boardDx, boardDy, 16, GRID);
      next.set(shape.id, shape);
    }
    setPreviewBoth(next);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (surface.current?.hasPointerCapture(e.pointerId)) {
      surface.current.releasePointerCapture(e.pointerId);
    }
    if (!d || d.mode === 'pan') return;
    // Commit what the drag changed, then drop the preview. The drag is one undo step.
    for (const [id, shape] of previewRef.current) {
      const geometry = { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
      if (cardsById.has(id)) {
        patchCard(doc, id, geometry);
      } else {
        const placement = placementsById.get(id);
        if (placement) {
          writePlacement(doc, id, { childBoardId: placement.item.childBoardId, ...geometry });
        }
      }
    }
    // A task card dropped on a column linked to a status moves the task to that status.
    for (const [id, shape] of previewRef.current) {
      const card = cardsById.get(id);
      if (card?.kind !== 'task') continue;
      const over = columnAt(
        cards,
        { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 },
        id,
      );
      // A column linked to a status that was deleted since then is treated as not linked.
      if (over?.statusId && statusName.has(over.statusId)) {
        dropOnStatus(card.taskId, over.statusId);
      }
    }
    setPreviewBoth(new Map());
  }

  function centreFor(width: number, height: number) {
    const c = screenToBoard(view, { x: size.width / 2, y: size.height / 2 });
    return { x: c.x - width / 2, y: c.y - height / 2 };
  }

  function addNote() {
    const { width, height } = SIZE.note;
    const id = crypto.randomUUID();
    writeCard(doc, { id, kind: 'note', ...centreFor(width, height), width, height, text: '' });
    setSelected(new Set([id]));
    setEditing(id);
  }

  function addColumn() {
    const { width, height } = SIZE.column;
    const id = crypto.randomUUID();
    writeCard(doc, { id, kind: 'column', ...centreFor(width, height), width, height, title: '' });
    setSelected(new Set([id]));
    setEditing(id);
  }

  function addLine(arrow: boolean) {
    const { width, height } = SIZE.line;
    const id = crypto.randomUUID();
    writeCard(doc, {
      id,
      kind: 'line',
      ...centreFor(width, height),
      width,
      height,
      reversed: false,
      arrow,
    });
    setSelected(new Set([id]));
  }

  function addFileCard(
    kind: 'image' | 'file',
    file: { fileId: string; name: string; mimeType: string },
  ) {
    const { width, height } = SIZE[kind];
    const id = crypto.randomUUID();
    const card: Card =
      kind === 'image'
        ? {
            id,
            kind,
            ...centreFor(width, height),
            width,
            height,
            fileId: file.fileId,
            name: file.name,
          }
        : {
            id,
            kind,
            ...centreFor(width, height),
            width,
            height,
            fileId: file.fileId,
            name: file.name,
            mimeType: file.mimeType,
          };
    writeCard(doc, card);
    setDialog(null);
  }

  function addLinkCard(preview: LinkPreview) {
    const { width, height } = SIZE.link;
    writeCard(doc, {
      id: crypto.randomUUID(),
      kind: 'link',
      ...centreFor(width, height),
      width,
      height,
      url: preview.url,
      title: preview.title,
      description: preview.description,
    });
    setDialog(null);
  }

  function duplicate(card: Card) {
    const id = crypto.randomUUID();
    writeCard(doc, { ...card, id, x: card.x + DUPLICATE_OFFSET, y: card.y + DUPLICATE_OFFSET });
    setSelected(new Set([id]));
  }

  const newBoard = useMutation({
    mutationFn: () => {
      const { x, y } = centreFor(240, 160);
      return api(`/boards/${boardId}/boards`, {
        method: 'POST',
        body: { title: 'New board', x, y },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['board', boardId] }),
  });

  // Moving a child board to the trash is for managers; the Host refuses others and says so.
  const trashBoard = useMutation({
    mutationFn: (childId: string) => api(`/boards/${childId}/trash`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['board', boardId] }),
  });

  const statuses = useStatuses(projectId);
  const statusName = new Map((statuses.data ?? []).map((s) => [s.id, s.name]));

  // A task dropped on a column linked to a status moves to that status (the Host checks the move).
  const moveTask = useMutation({
    mutationFn: ({ taskId, statusId }: { taskId: string; statusId: string }) =>
      api(`/tasks/${taskId}`, { method: 'PATCH', body: { statusId }, schema: taskSchema }),
    onSuccess: (task: Task) => {
      queryClient.setQueryData(['task', task.id], task);
      void queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
    },
  });
  function dropOnStatus(taskId: string, statusId: string) {
    const current = queryClient.getQueryData<Task>(['task', taskId]);
    if (current?.statusId !== statusId) moveTask.mutate({ taskId, statusId });
  }

  // The whole board as a PNG. Pictures and tasks that cannot be read are drawn as their names.
  const picture = useMutation({
    mutationFn: async () => {
      const images = new Map<string, ImageBitmap>();
      const tasks = new Map<string, PictureTask>();
      await Promise.all([
        ...cards.map(async (c) => {
          if (c.kind !== 'image' || images.has(c.fileId)) return;
          const blob = await fetchFileBlob(`/files/${c.fileId}/content`).catch(() => null);
          const bitmap = blob && (await createImageBitmap(blob).catch(() => null));
          if (bitmap) images.set(c.fileId, bitmap);
        }),
        ...cards.map(async (c) => {
          if (c.kind !== 'task') return;
          const task = await queryClient.fetchQuery(taskQuery(c.taskId)).catch(() => null);
          if (task)
            tasks.set(c.taskId, { title: task.title, status: statusName.get(task.statusId) ?? '' });
        }),
      ]);
      const blob = await boardPng({
        cards,
        boards: placements.map((p) => ({ title: p.item.title, ...p.geometry })),
        images,
        tasks,
        statusNames: statusName,
      });
      images.forEach((bitmap) => bitmap.close());
      saveBlob(blob, `${title} - board.png`);
    },
  });

  function addTaskCard(taskId: string) {
    const { width, height } = SIZE.task;
    writeCard(doc, {
      id: crypto.randomUUID(),
      kind: 'task',
      ...centreFor(width, height),
      width,
      height,
      taskId,
    });
    setDialog(null);
  }

  const selectedCard = selected.size === 1 ? [...selected][0]! : null;
  const selectedShape = selectedCard ? shown.find((s) => s.id === selectedCard) : undefined;
  const menuCard = menu ? cardsById.get(menu.id) : undefined;
  const menuPlacement = menu ? placementsById.get(menu.id) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div role="toolbar" aria-label="Add to board" className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={addNote}>
          Note
        </Button>
        <Button variant="secondary" onClick={addColumn}>
          Column
        </Button>
        <Button variant="secondary" onClick={() => addLine(false)}>
          Line
        </Button>
        <Button variant="secondary" onClick={() => addLine(true)}>
          Arrow
        </Button>
        <Button variant="secondary" onClick={() => setDialog('image')}>
          Picture
        </Button>
        <Button variant="secondary" onClick={() => setDialog('file')}>
          File
        </Button>
        <Button variant="secondary" onClick={() => setDialog('link')}>
          Link
        </Button>
        <Button variant="secondary" onClick={() => setDialog('task')}>
          Task
        </Button>
        <Button variant="secondary" loading={newBoard.isPending} onClick={() => newBoard.mutate()}>
          Board
        </Button>
        <Button variant="ghost" disabled={undo.undoStack.length === 0} onClick={() => undo.undo()}>
          Undo
        </Button>
        <Button variant="ghost" disabled={undo.redoStack.length === 0} onClick={() => undo.redo()}>
          Redo
        </Button>
        <Button variant="ghost" loading={picture.isPending} onClick={() => picture.mutate()}>
          Download PNG
        </Button>
        <span className="self-center text-xs text-muted">
          Drag the background to move around. Scroll to zoom. Right-click an item for more.
        </span>
      </div>
      {errorText(moveTask.error) && (
        <p role="alert" className="text-sm text-danger">
          {errorText(moveTask.error)}
        </p>
      )}
      {picture.error && (
        <p role="alert" className="text-sm text-danger">
          {picture.error.message}
        </p>
      )}
      {errorText(trashBoard.error) && (
        <p role="alert" className="text-sm text-danger">
          {errorText(trashBoard.error)}
        </p>
      )}

      <div
        ref={surface}
        role="region"
        aria-label="Board canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative min-h-[60vh] flex-1 touch-none overflow-hidden rounded-lg border border-line bg-surface-2"
      >
        {onScreen.map((shape) => {
          const at = boardToScreen(view, shape);
          const card = cardsById.get(shape.id);
          const placement = placementsById.get(shape.id);
          const isSelected = selected.has(shape.id);
          return (
            <div
              key={shape.id}
              data-item={shape.id}
              onDoubleClick={() => {
                if (placement) navigate(`/boards/${placement.item.childBoardId}`);
                else if (card?.kind === 'note' || card?.kind === 'column') setEditing(card.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setSelected(selectIds(selected, [shape.id], 'replace'));
                const rect = surface.current!.getBoundingClientRect();
                setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, id: shape.id });
              }}
              style={{
                left: at.x,
                top: at.y,
                width: shape.width * view.zoom,
                height: shape.height * view.zoom,
              }}
              className={cn(
                'absolute select-none overflow-hidden rounded-lg border bg-surface shadow-sm',
                isSelected ? 'border-accent ring-2 ring-accent' : 'border-line',
                card?.kind === 'column' && 'bg-surface-2',
                placement && 'bg-accent/5 font-medium',
              )}
            >
              {card && (
                <CardBody
                  card={card}
                  projectId={projectId}
                  linkedStatus={
                    card.kind === 'column' && card.statusId
                      ? statusName.get(card.statusId)
                      : undefined
                  }
                  editing={editing === card.id}
                  onText={(value) => {
                    const patch = editField(card, value);
                    if (patch) patchCard(doc, card.id, patch);
                  }}
                  onDoneEditing={() => setEditing(null)}
                />
              )}
              {placement && (
                <p className="p-2 text-sm">
                  <span aria-hidden="true">▣ </span>
                  {placement.item.title}
                </p>
              )}
            </div>
          );
        })}

        {selectedShape && (
          <div
            data-handle="se"
            aria-label="Resize"
            style={{
              left: boardToScreen(view, selectedShape).x + selectedShape.width * view.zoom - 6,
              top: boardToScreen(view, selectedShape).y + selectedShape.height * view.zoom - 6,
            }}
            className="absolute size-3 cursor-nwse-resize rounded-sm bg-accent"
          />
        )}

        {menu && (menuCard || menuPlacement) && (
          <ul
            role="menu"
            aria-label="Item actions"
            style={{ left: menu.x, top: menu.y }}
            className="absolute z-10 min-w-40 rounded-md border border-line bg-surface p-1 text-sm shadow-lg"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {menuCard && (menuCard.kind === 'note' || menuCard.kind === 'column') && (
              <MenuItem
                label="Rename"
                onSelect={() => {
                  setEditing(menuCard.id);
                  setMenu(null);
                }}
              />
            )}
            {menuCard?.kind === 'column' &&
              (statuses.data ?? []).map((s) => (
                <MenuItem
                  key={s.id}
                  label={`Link to ${s.name}`}
                  onSelect={() => {
                    patchCard(doc, menuCard.id, { statusId: s.id });
                    setMenu(null);
                  }}
                />
              ))}
            {menuCard?.kind === 'column' && menuCard.statusId && (
              <MenuItem
                label="Unlink status"
                onSelect={() => {
                  patchCard(doc, menuCard.id, { statusId: null });
                  setMenu(null);
                }}
              />
            )}
            {menuCard && (
              <MenuItem
                label="Duplicate"
                onSelect={() => {
                  duplicate(menuCard);
                  setMenu(null);
                }}
              />
            )}
            {menuCard && (
              <MenuItem
                label="Delete"
                onSelect={() => {
                  removeCard(doc, menuCard.id);
                  setSelected(new Set());
                  setMenu(null);
                }}
              />
            )}
            {menuPlacement && (
              <MenuItem
                label="Open board"
                onSelect={() => navigate(`/boards/${menuPlacement.item.childBoardId}`)}
              />
            )}
            {menuPlacement && (
              <MenuItem
                label="Move board to trash"
                onSelect={() => {
                  trashBoard.mutate(menuPlacement.item.childBoardId);
                  setMenu(null);
                }}
              />
            )}
            <MenuItem
              label="Undo"
              disabled={undo.undoStack.length === 0}
              onSelect={() => {
                undo.undo();
                setMenu(null);
              }}
            />
            <MenuItem
              label="Redo"
              disabled={undo.redoStack.length === 0}
              onSelect={() => {
                undo.redo();
                setMenu(null);
              }}
            />
          </ul>
        )}
      </div>

      {dialog === 'task' && (
        <TaskPickDialog
          projectId={projectId}
          onPick={addTaskCard}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'link' && (
        <LinkDialog boardId={boardId} onPreview={addLinkCard} onClose={() => setDialog(null)} />
      )}
      {(dialog === 'image' || dialog === 'file') && (
        <FilePickDialog
          projectId={projectId}
          kind={dialog}
          onPick={(file) => addFileCard(dialog, file)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function MenuItem({
  label,
  disabled = false,
  onSelect,
}: {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={onSelect}
        className="w-full rounded px-3 py-1.5 text-left hover:bg-surface-2 disabled:opacity-40"
      >
        {label}
      </button>
    </li>
  );
}
