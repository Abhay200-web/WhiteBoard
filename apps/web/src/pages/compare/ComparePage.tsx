import { useQuery } from '@tanstack/react-query';
import {
  deliverableListSchema,
  versionCompareSchema,
  type DeliverableVersion,
} from '@whiteboard/core';
import { Button, Field, Select, Spinner } from '@whiteboard/ui';
import { lazy, Suspense, useCallback, useRef, useState, type RefObject } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { FilePreview, previewKind, useFileLink } from '../../components/FilePreview';
import { FormError } from '../../components/AuthShell';
import { api, errorText, getHostUrl } from '../../lib/api';
import { formatDateTime } from '../projects/format';

const PdfViewer = lazy(() => import('../../components/PdfViewer'));

const ZOOM_MIN = 50;
const ZOOM_MAX = 300;
const ZOOM_STEP = 25;

/**
 * Two versions of one deliverable side by side: the file in each panel, with one zoom and one page
 * for both, and the two panels scroll together. The versions are picked from the selects; the choice
 * is kept in the address (`?a=&b=`), so a comparison can be opened again or shared.
 */
export function ComparePage() {
  const { taskId = '', deliverableId = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [zoom, setZoom] = useState(100);
  const [page, setPage] = useState(1);
  const [pageCounts, setPageCounts] = useState<{ a?: number; b?: number }>({});
  const reportA = useCallback((pages: number) => setPageCounts((c) => ({ ...c, a: pages })), []);
  const reportB = useCallback((pages: number) => setPageCounts((c) => ({ ...c, b: pages })), []);

  const list = useQuery({
    queryKey: ['deliverables', taskId],
    queryFn: () => api(`/tasks/${taskId}/deliverables`, { schema: deliverableListSchema }),
  });
  const versions = list.data?.find((d) => d.id === deliverableId)?.versions ?? [];
  const known = (id: string | null) => versions.some((v) => v.id === id);
  // Without a choice in the address, compare the last two versions.
  const a = known(params.get('a')) ? params.get('a')! : (versions.at(-2)?.id ?? '');
  const b = known(params.get('b')) ? params.get('b')! : (versions.at(-1)?.id ?? '');

  const compare = useQuery({
    queryKey: ['compare', a, b],
    queryFn: () => api(`/versions/compare?a=${a}&b=${b}`, { schema: versionCompareSchema }),
    enabled: a !== '' && b !== '',
  });

  // The two panels scroll together. A scroll we cause ourselves is skipped once on the other side,
  // so the two never pass the movement back and forth.
  const scrollA = useRef<HTMLDivElement>(null);
  const scrollB = useRef<HTMLDivElement>(null);
  const skip = useRef<HTMLDivElement | null>(null);
  function follow(source: HTMLDivElement | null, target: HTMLDivElement | null) {
    if (!source || !target) return;
    if (skip.current === source) {
      skip.current = null;
      return;
    }
    // Keep the same share of the scrollable distance, so panels of different sizes still line up.
    const share = (pos: number, from: number, to: number) => (from > 0 ? (pos / from) * to : 0);
    const top = share(
      source.scrollTop,
      source.scrollHeight - source.clientHeight,
      target.scrollHeight - target.clientHeight,
    );
    const left = share(
      source.scrollLeft,
      source.scrollWidth - source.clientWidth,
      target.scrollWidth - target.clientWidth,
    );
    if (Math.abs(target.scrollTop - top) < 1 && Math.abs(target.scrollLeft - left) < 1) return;
    skip.current = target;
    target.scrollTop = top;
    target.scrollLeft = left;
  }

  function choose(side: 'a' | 'b', id: string) {
    const next = new URLSearchParams(params);
    next.set(side, id);
    setParams(next, { replace: true });
  }

  if (list.isPending) return <Spinner />;
  if (!list.data || !list.data.some((d) => d.id === deliverableId)) {
    return <p className="text-sm text-danger">This deliverable could not be found.</p>;
  }
  const name = list.data.find((d) => d.id === deliverableId)!.name;
  if (versions.length < 2) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted">Send a second version to compare {name}.</p>
        <Button variant="secondary" className="self-start" onClick={() => navigate(-1)}>
          Back
        </Button>
      </div>
    );
  }

  const pdfShown =
    compare.data && [compare.data.a, compare.data.b].some((v) => previewKind(v.mimeType) === 'pdf');
  const counts = [pageCounts.a, pageCounts.b].filter((n): n is number => n !== undefined);
  const pageCount = counts.length > 0 ? Math.min(...counts) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-2 text-xl font-semibold">Compare {name}</h1>
        <Field label="Version A">
          <Select value={a} onChange={(e) => choose('a', e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.number} · {v.submittedBy}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Version B">
          <Select value={b} onChange={(e) => choose('b', e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.number} · {v.submittedBy}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button
          variant="secondary"
          disabled={zoom <= ZOOM_MIN}
          onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
        >
          Zoom out
        </Button>
        <span className="w-14 text-center">{zoom}%</span>
        <Button
          variant="secondary"
          disabled={zoom >= ZOOM_MAX}
          onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
        >
          Zoom in
        </Button>
        <Button variant="ghost" disabled={zoom === 100} onClick={() => setZoom(100)}>
          Reset zoom
        </Button>
        {pdfShown && (
          <>
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous page
            </Button>
            <span>
              Page {page}
              {pageCount !== undefined && ` of ${pageCount}`}
            </span>
            <Button
              variant="secondary"
              disabled={pageCount !== undefined && page >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              Next page
            </Button>
          </>
        )}
      </div>

      <FormError message={errorText(compare.error)} />
      {compare.isPending && <Spinner />}
      {compare.data && (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel
            version={compare.data.a}
            zoom={zoom}
            page={page}
            onPageCount={reportA}
            scroll={scrollA}
            onScroll={() => follow(scrollA.current, scrollB.current)}
          />
          <Panel
            version={compare.data.b}
            zoom={zoom}
            page={page}
            onPageCount={reportB}
            scroll={scrollB}
            onScroll={() => follow(scrollB.current, scrollA.current)}
          />
        </div>
      )}
    </div>
  );
}

function Panel({
  version,
  zoom,
  page,
  onPageCount,
  scroll,
  onScroll,
}: {
  version: DeliverableVersion;
  zoom: number;
  page: number;
  onPageCount: (pages: number) => void;
  scroll: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}) {
  return (
    <section aria-label={`Version ${version.number}`} className="flex min-w-0 flex-col gap-2">
      <p className="text-sm font-medium">
        v{version.number} · {version.name}{' '}
        <span className="font-normal text-muted">
          {version.submittedBy}, {formatDateTime(version.submittedAt)}
        </span>
      </p>
      <div
        ref={scroll}
        onScroll={onScroll}
        className="h-[70vh] overflow-auto rounded-md border border-line bg-surface p-2"
      >
        <Media version={version} zoom={zoom} page={page} onPageCount={onPageCount} />
      </div>
    </section>
  );
}

/** The file of one panel. Images and PDFs follow the shared zoom and page; other types use the preview. */
function Media({
  version,
  zoom,
  page,
  onPageCount,
}: {
  version: DeliverableVersion;
  zoom: number;
  page: number;
  onPageCount: (pages: number) => void;
}) {
  const kind = previewKind(version.mimeType);
  const link = useFileLink(version.fileId, kind === 'image' || kind === 'pdf');
  if (kind !== 'image' && kind !== 'pdf') {
    return <FilePreview fileId={version.fileId} name={version.name} mimeType={version.mimeType} />;
  }
  if (link.isError) return <p className="text-sm text-danger">Could not load this file.</p>;
  if (link.isPending) return <Spinner label={`Loading ${version.name}`} />;
  const url = `${getHostUrl()}${link.data.url}`;
  if (kind === 'image') {
    return (
      <img
        src={url}
        alt={version.name}
        style={{ width: `${zoom}%`, maxWidth: 'none' }}
        className="block"
      />
    );
  }
  return (
    <Suspense fallback={<Spinner label="Loading PDF viewer" />}>
      <PdfViewer
        url={url}
        name={version.name}
        scale={zoom / 100}
        page={page}
        onPageCount={onPageCount}
      />
    </Suspense>
  );
}
