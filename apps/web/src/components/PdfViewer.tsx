import { Button } from '@whiteboard/ui';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState, type ReactNode } from 'react';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Shows a PDF page by page with pdf.js. Loaded lazily, so the app does not pay for it up front.
 * `url` is a file link; pdf.js reads it in byte ranges, so a big PDF shows its first page early.
 * The compare view passes `page` and `onPageChange` to drive the page itself, and `scale` to zoom.
 */
export default function PdfViewer({
  url,
  name,
  scale = 1.4,
  page: pageProp,
  onPageChange,
  onPageCount,
  overlay,
}: {
  url: string;
  name: string;
  scale?: number;
  page?: number;
  onPageChange?: (page: number) => void;
  /** Told how many pages the document has, once it has loaded. Pass a stable function. */
  onPageCount?: (pages: number) => void;
  /** Drawn over the page (same size as it), for pins. Told which page is showing. */
  overlay?: (page: number) => ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [ownPage, setOwnPage] = useState(1);
  const [error, setError] = useState(false);
  const controlled = pageProp !== undefined;
  const page = pageProp ?? ownPage;
  const goTo = (next: number) => (onPageChange ?? setOwnPage)(next);

  useEffect(() => {
    let cancelled = false;
    const loadingTask = pdfjs.getDocument({ url });
    loadingTask.promise
      .then((pdf) => {
        if (!cancelled) {
          setDoc(pdf);
          setOwnPage(1);
          onPageCount?.(pdf.numPages);
        }
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      void loadingTask.destroy();
    };
  }, [url, onPageCount]);

  useEffect(() => {
    if (!doc || !canvas.current) return;
    let task: pdfjs.RenderTask | null = null;
    let cancelled = false;
    // A page past the end (the other PDF of a comparison is shorter) shows the last page.
    void doc.getPage(Math.min(page, doc.numPages)).then((p) => {
      const el = canvas.current;
      if (cancelled || !el) return;
      const viewport = p.getViewport({ scale });
      el.width = viewport.width;
      el.height = viewport.height;
      task = p.render({ canvas: el, viewport });
      task.promise.catch(() => undefined); // a cancelled render rejects; that is expected
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, scale]);

  if (error) return <p className="text-sm text-danger">This PDF could not be shown.</p>;
  return (
    <div>
      {!controlled && doc && doc.numPages > 1 && (
        <div className="mb-2 flex items-center gap-2 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            Previous page
          </Button>
          <span>
            Page {page} of {doc.numPages}
          </span>
          <Button
            variant="secondary"
            disabled={page >= doc.numPages}
            onClick={() => goTo(page + 1)}
          >
            Next page
          </Button>
        </div>
      )}
      <div className="relative inline-block max-w-full">
        <canvas
          ref={canvas}
          aria-label={`${name}, page ${page}`}
          // A compared page is zoomed past the panel and scrolls, so it must not shrink to fit.
          className={controlled ? 'max-w-none border border-line' : 'max-w-full border border-line'}
        />
        {overlay?.(page)}
      </div>
    </div>
  );
}
