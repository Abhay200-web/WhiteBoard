import { useQuery } from '@tanstack/react-query';
import { boardDetailSchema } from '@whiteboard/core';
import { Spinner } from '@whiteboard/ui';
import { Link, useParams } from 'react-router';

import { BoardCanvas } from '../../components/board/BoardCanvas';
import { useAuth } from '../../auth/AuthProvider';
import { api, errorText } from '../../lib/api';
import { colorFor, useLiveBoard } from '../../lib/boardSync';

/** One board, live: its trail, who else is here, and the canvas. */
export function BoardPage({ boardId }: { boardId: string }) {
  const { user } = useAuth();
  const detail = useQuery({
    queryKey: ['board', boardId],
    queryFn: () => api(`/boards/${boardId}`, { schema: boardDetailSchema }),
  });
  const live = useLiveBoard(boardId, {
    name: user?.name ?? '',
    color: colorFor(user?.id ?? ''),
  });

  if (detail.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {errorText(detail.error)}
      </p>
    );
  }
  if (!detail.data || !live) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Opening board…
      </div>
    );
  }

  const board = detail.data;
  const status = !live.online
    ? 'Offline: your changes are kept on this PC and sent when the Host is back'
    : live.synced
      ? 'Live'
      : 'Connecting…';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Board trail" className="flex flex-wrap items-center gap-1 text-sm">
          {board.breadcrumbs.map((crumb, i) => (
            <span key={crumb.id} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted">›</span>}
              {crumb.id === board.id ? (
                <span aria-current="page" className="font-semibold">
                  {crumb.title}
                </span>
              ) : (
                <Link to={`/boards/${crumb.id}`} className="text-accent underline">
                  {crumb.title}
                </Link>
              )}
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-xs">
          <span aria-label="Connection">{status}</span>
          {live.peers.length > 0 && (
            <ul aria-label="Also on this board" className="flex items-center gap-1">
              {live.peers.map((p) => (
                <li
                  key={p.name + p.color}
                  className="rounded-full px-2 py-0.5 text-white"
                  style={{ background: p.color }}
                >
                  {p.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <BoardCanvas
        boardId={board.id}
        projectId={board.projectId}
        doc={live.doc}
        items={board.items}
      />
    </div>
  );
}

/** `/boards/:boardId`: any board the person can see. */
export function BoardRoute() {
  const { boardId } = useParams();
  return <BoardPage key={boardId} boardId={boardId!} />;
}

/** `/projects/:id/canvas`: the project's main board (created on the first visit). */
export function ProjectCanvasRoute() {
  const { id } = useParams();
  const root = useQuery({
    queryKey: ['project-root-board', id],
    queryFn: () => api(`/projects/${id}/boards/root`, { schema: boardDetailSchema }),
  });
  if (root.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {errorText(root.error)}
      </p>
    );
  }
  if (!root.data) return <Spinner />;
  return <BoardPage key={root.data.id} boardId={root.data.id} />;
}
