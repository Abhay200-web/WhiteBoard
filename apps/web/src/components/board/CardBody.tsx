import type { Card } from '@whiteboard/core';
import { Button } from '@whiteboard/ui';

import { fetchFileBlob } from '../../lib/files';
import { saveBlob, useFileLink } from '../FilePreview';

/** What is inside a card, by kind. The place and size are drawn by the board around it. */
export function CardBody({
  card,
  editing,
  onText,
  onDoneEditing,
}: {
  card: Card;
  editing: boolean;
  onText: (text: string) => void;
  onDoneEditing: () => void;
}) {
  switch (card.kind) {
    case 'note':
      if (editing) {
        return (
          <textarea
            autoFocus
            aria-label="Note text"
            defaultValue={card.text}
            onBlur={(e) => {
              onText(e.currentTarget.value);
              onDoneEditing();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') e.currentTarget.blur();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="h-full w-full resize-none bg-transparent p-2 text-sm outline-none"
          />
        );
      }
      return (
        <p className="h-full w-full overflow-hidden whitespace-pre-wrap p-2 text-sm">
          {card.text || <span className="text-muted">Double-click to write</span>}
        </p>
      );
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
