import { Button } from '@whiteboard/ui';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Shows a PDF page by page with pdf.js. Loaded lazily, so the app does not pay for it up front. */
export default function PdfViewer({ blob, name }: { blob: Blob; name: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
    void blob
      .arrayBuffer()
      .then((data) => {
        if (cancelled) return null;
        loadingTask = pdfjs.getDocument({ data });
        return loadingTask.promise;
      })
      .then((pdf) => {
        if (pdf && !cancelled) {
          setDoc(pdf);
          setPage(1);
        }
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [blob]);

  useEffect(() => {
    if (!doc || !canvas.current) return;
    let task: pdfjs.RenderTask | null = null;
    let cancelled = false;
    void doc.getPage(page).then((p) => {
      const el = canvas.current;
      if (cancelled || !el) return;
      const viewport = p.getViewport({ scale: 1.4 });
      el.width = viewport.width;
      el.height = viewport.height;
      task = p.render({ canvas: el, viewport });
      task.promise.catch(() => undefined); // a cancelled render rejects; that is expected
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page]);

  if (error) return <p className="text-sm text-danger">This PDF could not be shown.</p>;
  return (
    <div>
      {doc && doc.numPages > 1 && (
        <div className="mb-2 flex items-center gap-2 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous page
          </Button>
          <span>
            Page {page} of {doc.numPages}
          </span>
          <Button
            variant="secondary"
            disabled={page >= doc.numPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next page
          </Button>
        </div>
      )}
      <canvas
        ref={canvas}
        aria-label={`${name}, page ${page}`}
        className="max-w-full border border-line"
      />
    </div>
  );
}
