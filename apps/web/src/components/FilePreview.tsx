import { useMutation, useQuery } from '@tanstack/react-query';
import { fileLinkSchema } from '@whiteboard/core';
import { Button, Spinner } from '@whiteboard/ui';
import { lazy, Suspense, useEffect, useMemo } from 'react';

import { api, ApiError, getHostUrl } from '../lib/api';
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

/**
 * A short-lived link to a file on the Host, for media tags. A new link changes the src and restarts
 * a playing video, so it is only renewed when the preview opens again after a while, well before
 * the link runs out.
 */
export function useFileLink(fileId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['file-link', fileId],
    queryFn: () => api(`/files/${fileId}/link`, { method: 'POST', schema: fileLinkSchema }),
    enabled,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
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
 * Shows an image, PDF or video from the Host. Other types get a Download button. Media tags cannot
 * send the sign-in header, so the Host gives a short-lived link (1 hour); a video then streams
 * with byte ranges instead of loading whole first. Download fetches the file only when clicked.
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
  const link = useFileLink(fileId, kind !== 'other');
  const download = useMutation({
    mutationFn: async () => saveBlob(await fetchFileBlob(`/files/${fileId}/content`), name),
  });

  const downloadButton = (
    <>
      <Button
        variant="secondary"
        loading={download.isPending}
        onClick={() => download.mutate()}
        className="self-start"
      >
        Download {name}
      </Button>
      {download.isError && (
        <p role="alert" className="text-sm text-danger">
          Could not download this file.
        </p>
      )}
    </>
  );
  if (kind === 'other') {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted">No preview for this type of file.</p>
        {downloadButton}
      </div>
    );
  }
  if (link.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {link.error instanceof ApiError && link.error.status === 404
          ? 'This file is not available to you.'
          : 'Could not load this file.'}
      </p>
    );
  }
  if (link.isPending) return <Spinner label={`Loading ${name}`} />;

  const url = `${getHostUrl()}${link.data.url}`;
  if (kind === 'image') {
    return (
      <img src={url} alt={name} className="max-h-[70vh] max-w-full rounded-md border border-line" />
    );
  }
  if (kind === 'video') {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        aria-label={name}
        className="max-h-[70vh] max-w-full rounded-md"
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Suspense fallback={<Spinner label="Loading PDF viewer" />}>
        <PdfViewer url={url} name={name} />
      </Suspense>
      {downloadButton}
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
