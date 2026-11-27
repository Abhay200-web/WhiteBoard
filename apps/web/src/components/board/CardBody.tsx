import type { Card } from '@whiteboard/core';
import { Button } from '@whiteboard/ui';

import { fetchFileBlob } from '../../lib/files';
import { saveBlob, useFileLink } from '../FilePreview';
import { TaskBody } from './TaskBody';

/** What is inside a card, by kind. The place and size are drawn by the board around it. */
export function CardBody({
  card,
  projectId,
  editing,
  linkedStatus,
  onText,
  onDoneEditing,
}: {
  card: Card;
  projectId: string;
  editing: boolean;
  /** The name of the task status a column is linked to, if any. */
  linkedStatus?: string;
  /** The new text of a note, or the new title of a column. */
  onText: (text: string) => void;
  onDoneEditing: () => void;
}) {
  switch (card.kind) {
    case 'note':
      if (editing) {
        return (
          <TextEditor
            label="Note text"
            value={card.text}
            multiline
            onCommit={(value) => {
              onText(value);
              onDoneEditing();
            }}
          />
        );
      }
      return (
        <p className="h-full w-full overflow-hidden whitespace-pre-wrap p-2 text-sm">
          {card.text || <span className="text-muted">Double-click to write</span>}
        </p>
      );
    case 'column':
      if (editing) {
        return (
          <TextEditor
            label="Column title"
            value={card.title}
            onCommit={(value) => {
              onText(value);
              onDoneEditing();
            }}
          />
        );
      }
      return (
        <div className="h-full w-full">
          <p className="border-b border-line px-3 py-2 text-sm font-semibold">
            {card.title || 'Untitled column'}
          </p>
          {linkedStatus && (
            <p className="px-3 pt-2 text-xs text-muted">
              Tasks dropped here become: {linkedStatus}
            </p>
          )}
        </div>
      );
    case 'line':
      return <LineBody card={card} />;
    case 'task':
      return <TaskBody taskId={card.taskId} projectId={projectId} />;
    case 'image':
      return <ImageBody fileId={card.fileId} name={card.name} />;
    case 'file':
      return <FileBody fileId={card.fileId} name={card.name} />;
    case 'link':
      return (
        <a
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          onPointerDown={(e) => e.stopPropagation()}
          className="block h-full overflow-hidden p-3 text-sm"
        >
          <span className="block font-medium">{card.title || card.url}</span>
          {card.description && <span className="mt-1 block text-muted">{card.description}</span>}
        </a>
      );
  }
}

/** A text box that saves when it loses focus; Escape leaves it. */
function TextEditor({
  label,
  value,
  multiline = false,
  onCommit,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onCommit: (value: string) => void;
}) {
  const common = {
    autoFocus: true,
    'aria-label': label,
    defaultValue: value,
    onBlur: (e: { currentTarget: { value: string } }) => onCommit(e.currentTarget.value),
    onKeyDown: (e: { key: string; currentTarget: HTMLElement }) => {
      if (e.key === 'Escape') e.currentTarget.blur();
    },
    onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  };
  return multiline ? (
    <textarea
      {...common}
      className="h-full w-full resize-none bg-transparent p-2 text-sm outline-none"
    />
  ) : (
    <input
      {...common}
      className="w-full bg-transparent px-3 py-2 text-sm font-semibold outline-none"
    />
  );
}

/** A straight line across its box; the arrow head sits at the end, which is the bottom-right unless reversed. */
function LineBody({ card }: { card: Extract<Card, { kind: 'line' }> }) {
  const marker = `arrow-${card.id}`;
  const [x1, y1, x2, y2] = card.reversed
    ? [0, card.height, card.width, 0]
    : [0, 0, card.width, card.height];
  return (
    <svg width="100%" height="100%" aria-hidden="true" className="text-text">
      {card.arrow && (
        <defs>
          <marker
            id={marker}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
      )}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="currentColor"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        markerEnd={card.arrow ? `url(#${marker})` : undefined}
      />
    </svg>
  );
}

function ImageBody({ fileId, name }: { fileId: string; name: string }) {
  const link = useFileLink(fileId, true);
  if (!link.data) return <p className="p-2 text-sm text-muted">Loading picture…</p>;
  return (
    <img
      src={link.data.url}
      alt={name}
      draggable={false}
      className="h-full w-full object-contain"
    />
  );
}

function FileBody({ fileId, name }: { fileId: string; name: string }) {
  return (
    <div className="flex h-full flex-col justify-between gap-2 p-3 text-sm">
      <span className="truncate font-medium">{name}</span>
      <Button
        variant="secondary"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={async () => saveBlob(await fetchFileBlob(`/files/${fileId}/content`), name)}
      >
        Download
      </Button>
    </div>
  );
}
