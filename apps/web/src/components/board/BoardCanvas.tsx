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

import { api } from '../../lib/api';
import {
  patchCard,
  readCards,
  readPlacement,
  removeCard,
  writeCard,
  writePlacement,
} from '../../lib/cards';
import { CardBody } from './CardBody';
import { FilePickDialog, LinkDialog } from './AddDialogs';

/** Positions snap to this grid, in board units. */
const GRID = 8;

const SIZE = {
  note: { width: 220, height: 140 },
  image: { width: 240, height: 180 },
  file: { width: 240, height: 88 },
  link: { width: 260, height: 120 },
} as const;

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

/**
 * The board surface: cards and child boards placed on it, panned, zoomed, selected, dragged and
 * resized. Every change is written to the live document, so everyone else sees it.
 */
export function BoardCanvas({
  boardId,
  projectId,
  doc,
  items,
}: {
  boardId: string;
  projectId: string;
  doc: Y.Doc;
  items: BoardItem[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const version = useDocVersion(doc);
  const surface = useRef<HTMLDivElement>(null);
  const size = useElementSize(surface);

  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState<Map<string, CanvasItem>>(new Map());
  const [dialog, setDialog] = useState<null | 'link' | 'image' | 'file'>(null);
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

  // Delete removes the selected cards (child boards are removed from their own screen later).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing || (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName))) {
        return;
      }
      if (e.key === 'Escape') setSelected(new Set());
      if (e.key === 'Delete' || e.key === 'Backspace') {
        for (const id of selected) if (cardsById.has(id)) removeCard(doc, id);
        setSelected(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, editing, selected, cardsById]);

  function pointIn(e: { clientX: number; clientY: number }) {
    const rect = surface.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
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
    // Commit what the drag changed, then drop the preview.
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

  const selectedCard = selected.size === 1 ? [...selected][0]! : null;
  const selectedShape = selectedCard ? shown.find((s) => s.id === selectedCard) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div role="toolbar" aria-label="Add to board" className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={addNote}>
          Note
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
        <Button variant="secondary" loading={newBoard.isPending} onClick={() => newBoard.mutate()}>
          Board
        </Button>
        <span className="self-center text-xs text-muted">
          Drag the background to move around. Scroll to zoom. Double-click a board to open it.
        </span>
      </div>

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
                else if (card?.kind === 'note') setEditing(card.id);
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
                placement && 'bg-accent/5 font-medium',
              )}
            >
              {card && (
                <CardBody
                  card={card}
                  editing={editing === card.id}
                  onText={(text) => patchCard(doc, card.id, { text } as Partial<Card>)}
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
      </div>

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
