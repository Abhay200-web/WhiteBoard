import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  pinCommentListSchema,
  pinListSchema,
  pinSchema,
  type Pin,
  type PinState,
} from '@whiteboard/core';
import { Button, Field, Select, Spinner, cn } from '@whiteboard/ui';
import { useState } from 'react';

import { api, errorText } from '../lib/api';
import { FilePreview, previewKind } from './FilePreview';
import { FormError } from './AuthShell';

type Filter = 'open' | 'resolved' | 'all';

/**
 * A version's preview with numbered pins on it, and a side panel with each pin's thread. Click the
 * preview to drop a pin (a new one opens at once). Pins belong to the version and page they were
 * dropped on. Pins work on images and PDFs; a video shows without them.
 */
export function PinnedPreview({
  versionId,
  fileId,
  name,
  mimeType,
}: {
  versionId: string;
  fileId: string;
  name: string;
  mimeType: string;
}) {
  const queryClient = useQueryClient();
  const pinsKey = ['pins', versionId];
  const list = useQuery({
    queryKey: pinsKey,
    queryFn: () => api(`/versions/${versionId}/pins`, { schema: pinListSchema }),
    enabled: previewKind(mimeType) !== 'video',
  });
  const [filter, setFilter] = useState<Filter>('open');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (at: { page: number; x: number; y: number }) =>
      api(`/versions/${versionId}/pins`, { method: 'POST', body: at, schema: pinSchema }),
    onSuccess: (pin) => {
      setSelectedId(pin.id);
      void queryClient.invalidateQueries({ queryKey: pinsKey });
    },
  });

  if (previewKind(mimeType) === 'video') {
    return (
      <div className="flex flex-col gap-2">
        <FilePreview fileId={fileId} name={name} mimeType={mimeType} />
        <p className="text-sm text-muted">Pins are not available on videos yet.</p>
      </div>
    );
  }

  const pins = (list.data ?? []).filter((p) => filter === 'all' || p.state === filter);
  const selected = list.data?.find((p) => p.id === selectedId);

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <div className="min-w-0 flex-1">
        <FilePreview
          fileId={fileId}
          name={name}
          mimeType={mimeType}
          overlay={(page) => (
            <PinLayer
              page={page}
              pins={pins}
              selectedId={selectedId}
              onAdd={(at) => add.mutate(at)}
              onSelect={setSelectedId}
            />
          )}
        />
        <FormError message={errorText(add.error)} />
      </div>

      <aside aria-label={`Pins on ${name}`} className="flex w-full flex-col gap-3 md:w-72">
        {list.isPending && <Spinner />}
        <Field label="Show">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="open">Open pins</option>
            <option value="resolved">Resolved pins</option>
            <option value="all">All pins</option>
          </Select>
        </Field>
        {list.data && pins.length === 0 && (
          <p className="text-sm text-muted">No pins to show. Click the preview to add one.</p>
        )}
        <ul className="flex flex-col gap-1 text-sm">
          {pins.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setSelectedId(p.id)}
                aria-pressed={p.id === selectedId}
                className={cn(
                  'w-full rounded-md px-2 py-1 text-left hover:bg-surface',
                  p.id === selectedId && 'bg-surface font-medium',
                )}
              >
                Pin {p.number} · page {p.page} · {p.state === 'open' ? 'open' : 'resolved'}
              </button>
            </li>
          ))}
        </ul>
        {selected && <PinThread key={selected.id} pin={selected} />}
      </aside>
    </div>
  );
}

/** Covers the page the preview shows. A click on the page drops a pin there; a pin is a button. */
function PinLayer({
  page,
  pins,
  selectedId,
  onAdd,
  onSelect,
}: {
  page: number;
  pins: Pin[];
  selectedId: string | null;
  onAdd: (at: { page: number; x: number; y: number }) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className="absolute inset-0 cursor-crosshair"
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        onAdd({
          page,
          x: (e.clientX - box.left) / box.width,
          y: (e.clientY - box.top) / box.height,
        });
      }}
    >
      {pins
        .filter((p) => p.page === page)
        .map((p) => (
          <button
            key={p.id}
            type="button"
            aria-label={`Pin ${p.number}, ${p.state}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(p.id);
            }}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            className={cn(
              'absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center',
              'rounded-full border text-xs font-semibold shadow',
              p.state === 'open'
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-line bg-surface text-muted',
              p.id === selectedId && 'ring-2 ring-text',
            )}
          >
            {p.number}
          </button>
        ))}
    </div>
  );
}

/** One pin's thread: its messages, a reply box, and resolve / reopen. */
function PinThread({ pin }: { pin: Pin }) {
  const queryClient = useQueryClient();
  const threadKey = ['pin-comments', pin.id];
  const [body, setBody] = useState('');
  const thread = useQuery({
    queryKey: threadKey,
    queryFn: () => api(`/pins/${pin.id}/comments`, { schema: pinCommentListSchema }),
  });
  const reply = useMutation({
    mutationFn: () =>
      api(`/pins/${pin.id}/comments`, {
        method: 'POST',
        body: { body },
        schema: pinCommentListSchema,
      }),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: threadKey });
    },
  });
  const nextState: PinState = pin.state === 'open' ? 'resolved' : 'open';
  const setState = useMutation({
    mutationFn: () =>
      api(`/pins/${pin.id}`, { method: 'PATCH', body: { state: nextState }, schema: pinSchema }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pins', pin.versionId] }),
  });

  return (
    <section
      aria-label={`Pin ${pin.number} thread`}
      className="flex flex-col gap-2 border-t border-line pt-3"
    >
      <div className="flex items-center justify-between gap-2 text-sm">
        <p className="font-medium">Pin {pin.number}</p>
        <Button variant="secondary" loading={setState.isPending} onClick={() => setState.mutate()}>
          {pin.state === 'open' ? 'Resolve' : 'Reopen'}
        </Button>
      </div>
      <FormError message={errorText(setState.error)} />
      {thread.isPending && <Spinner />}
      {thread.data?.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
      <ul className="flex flex-col gap-2 text-sm">
        {thread.data?.map((c) => (
          <li key={c.id}>
            <p className="text-muted">{c.authorName}</p>
            <p className="whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ul>
      <textarea
        aria-label="Reply"
        value={body}
        maxLength={2000}
        rows={2}
        onChange={(e) => setBody(e.target.value)}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-text placeholder:text-muted"
      />
      <FormError message={errorText(reply.error)} />
      <Button
        variant="secondary"
        disabled={body.trim() === '' || reply.isPending}
        onClick={() => reply.mutate()}
        className="self-end"
      >
        Reply
      </Button>
    </section>
  );
}
