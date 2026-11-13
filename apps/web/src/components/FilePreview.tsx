import { useQuery } from '@tanstack/react-query';
import { Button, Spinner } from '@whiteboard/ui';
import { lazy, Suspense, useEffect, useMemo } from 'react';

import { ApiError } from '../lib/api';
import { fetchFileBlob } from '../lib/files';

const PdfViewer = lazy(() => import('./PdfViewer'));

export type PreviewKind = 'image' | 'pdf' | 'video' | 'other';

export function previewKind(mimeType: string): PreviewKind {
  if (/^image\/(png|jpeg|gif|webp|avif)$/.test(mimeType)) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (/^video\/(mp4|webm)$/.test(mimeType)) return 'video';
  return 'other';
}

/** Object URL for a blob that is revoked when it changes or the component goes away. */
function useObjectUrl(blob: Blob | undefined): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url;
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Shows an image, PDF or video from the Host. Other types get a Download button. The file is
 * fetched with the session token (media tags cannot send headers) and shown from memory.
 */
export function FilePreview({
  fileId,
  name,
  mimeType,
}: {
  fileId: string;
  name: string;
  mimeType: string;
}) {
  const kind = previewKind(mimeType);
  const file = useQuery({
    queryKey: ['file-content', fileId],
    queryFn: ({ signal }) => fetchFileBlob(`/files/${fileId}/content`, signal),
    staleTime: Infinity,
    gcTime: 60_000,
  });
  const url = useObjectUrl(file.data);

  if (file.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {file.error instanceof ApiError && file.error.status === 404
          ? 'This file is not available to you.'
          : 'Could not load this file.'}
      </p>
    );
  }
  if (file.isPending) return <Spinner label={`Loading ${name}`} />;

  const download = (
    <Button variant="secondary" onClick={() => saveBlob(file.data, name)}>
      Download {name}
    </Button>
  );
  if (kind === 'image' && url) {
    return (
      <img src={url} alt={name} className="max-h-[70vh] max-w-full rounded-md border border-line" />
    );
  }
  if (kind === 'video' && url) {
    return (
      <video src={url} controls aria-label={name} className="max-h-[70vh] max-w-full rounded-md" />
    );
  }
  if (kind === 'pdf') {
    return (
      <div className="flex flex-col gap-2">
        <Suspense fallback={<Spinner label="Loading PDF viewer" />}>
          <PdfViewer blob={file.data} name={name} />
        </Suspense>
        {download}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted">No preview for this type of file.</p>
      {download}
    </div>
  );
}

/** Small thumbnail for lists; falls back to nothing if the file has none. */
export function FileThumbnail({ fileId, name }: { fileId: string; name: string }) {
  const thumb = useQuery({
    queryKey: ['file-thumbnail', fileId],
    queryFn: ({ signal }) => fetchFileBlob(`/files/${fileId}/thumbnail`, signal),
    staleTime: Infinity,
    gcTime: 60_000,
  });
  const url = useObjectUrl(thumb.data);
  return url ? <img src={url} alt={name} className="size-16 rounded object-cover" /> : null;
}
