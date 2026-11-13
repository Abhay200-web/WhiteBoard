import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from 'react';

import { Button } from './Button';
import { cn } from './cn';

export interface UploadControls {
  /** Report progress as a fraction from 0 to 1. */
  onProgress: (fraction: number) => void;
  /** Aborted when the person clicks Cancel (or the uploader goes away). */
  signal: AbortSignal;
}

export interface FileUploaderProps<T> {
  /** Sends one file to the Host. Reject to show an error and offer Retry. */
  upload: (file: File, controls: UploadControls) => Promise<T>;
  /** Called after each file is stored. */
  onUploaded?: (result: T, file: File) => void;
  multiple?: boolean;
  /** Passed to the file picker, e.g. `image/*,application/pdf`. */
  accept?: string;
  /** Files over this size are refused before anything is sent. */
  maxBytes?: number;
  className?: string;
}

type Status = 'uploading' | 'done' | 'error' | 'cancelled';
interface Item {
  id: number;
  file: File;
  status: Status;
  progress: number;
  error: string | null;
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(Math.round(bytes / 1024), 1)} KB`;

/**
 * Pick or drop files and send them with progress, Cancel and Retry. It knows nothing about the
 * Host: the app passes `upload`, so the same component works for project files and task files.
 */
export function FileUploader<T>({
  upload,
  onUploaded,
  multiple = true,
  accept,
  maxBytes,
  className,
}: FileUploaderProps<T>) {
  const inputId = useId();
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const controllers = useRef(new Map<number, AbortController>());
  const nextId = useRef(1);
  const uploadRef = useRef(upload);
  const uploadedRef = useRef(onUploaded);
  uploadRef.current = upload;
  uploadedRef.current = onUploaded;

  const patch = useCallback((id: number, changes: Partial<Item>) => {
    setItems((all) => all.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const start = useCallback(
    async (id: number, file: File) => {
      const controller = new AbortController();
      controllers.current.set(id, controller);
      patch(id, { status: 'uploading', progress: 0, error: null });
      try {
        const result = await uploadRef.current(file, {
          signal: controller.signal,
          onProgress: (fraction) => patch(id, { progress: Math.min(Math.max(fraction, 0), 1) }),
        });
        if (controller.signal.aborted) return patch(id, { status: 'cancelled' });
        patch(id, { status: 'done', progress: 1 });
        uploadedRef.current?.(result, file);
      } catch (err) {
        if (controller.signal.aborted) return patch(id, { status: 'cancelled' });
        patch(id, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Upload failed',
        });
      } finally {
        controllers.current.delete(id);
      }
    },
    [patch],
  );

  useEffect(() => {
    const running = controllers.current;
    return () => running.forEach((controller) => controller.abort());
  }, []);

  function add(list: FileList | File[] | null) {
    const chosen = Array.from(list ?? []);
    if (chosen.length === 0) return;
    for (const file of multiple ? chosen : chosen.slice(0, 1)) {
      const id = nextId.current++;
      if (maxBytes !== undefined && file.size > maxBytes) {
        const entry: Item = {
          id,
          file,
          status: 'error',
          progress: 0,
          error: `Too large (limit ${formatSize(maxBytes)})`,
        };
        setItems((all) => [...all, entry]);
        continue;
      }
      setItems((all) => [...all, { id, file, status: 'uploading', progress: 0, error: null }]);
      void start(id, file);
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    add(event.dataTransfer.files);
  }

  return (
    <div className={className}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-lg border-2 border-dashed border-line p-6 text-center text-sm',
          dragging && 'border-accent bg-surface-2',
        )}
      >
        <p className="text-muted">Drop {multiple ? 'files' : 'a file'} here, or</p>
        <label
          htmlFor={inputId}
          className="mt-2 inline-flex h-9 cursor-pointer items-center rounded-md border border-line bg-surface-2 px-4 font-medium hover:bg-line has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
        >
          Choose {multiple ? 'files' : 'a file'}
          <input
            id={inputId}
            type="file"
            multiple={multiple}
            accept={accept}
            className="sr-only"
            onChange={(event) => {
              add(event.currentTarget.files);
              event.currentTarget.value = ''; // picking the same file again must fire onChange
            }}
          />
        </label>
      </div>

      {items.length > 0 && (
        <ul aria-label="Uploads" className="mt-3 flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border border-line p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{item.file.name}</span>
                <span className="shrink-0 text-muted">{formatSize(item.file.size)}</span>
              </div>
              {item.status === 'uploading' && (
                <div
                  role="progressbar"
                  aria-label={`Uploading ${item.file.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(item.progress * 100)}
                  className="mt-2 h-1.5 overflow-hidden rounded bg-surface-2"
                >
                  <div
                    className="h-full bg-accent transition-[width]"
                    style={{ width: `${Math.round(item.progress * 100)}%` }}
                  />
                </div>
              )}
              <div className="mt-2 flex items-center justify-between gap-3">
                <span
                  className={cn(
                    item.status === 'error' && 'text-danger',
                    item.status === 'done' && 'text-success',
                    (item.status === 'uploading' || item.status === 'cancelled') && 'text-muted',
                  )}
                  role={item.status === 'error' ? 'alert' : undefined}
                >
                  {item.status === 'uploading' && `Uploading ${Math.round(item.progress * 100)}%`}
                  {item.status === 'done' && 'Uploaded'}
                  {item.status === 'cancelled' && 'Cancelled'}
                  {item.status === 'error' && item.error}
                </span>
                <span className="flex gap-1">
                  {item.status === 'uploading' && (
                    <Button
                      variant="ghost"
                      aria-label={`Cancel ${item.file.name}`}
                      onClick={() => controllers.current.get(item.id)?.abort()}
                    >
                      Cancel
                    </Button>
                  )}
                  {(item.status === 'error' || item.status === 'cancelled') &&
                    (maxBytes === undefined || item.file.size <= maxBytes) && (
                      <Button
                        variant="secondary"
                        aria-label={`Retry ${item.file.name}`}
                        onClick={() => void start(item.id, item.file)}
                      >
                        Retry
                      </Button>
                    )}
                  {item.status !== 'uploading' && (
                    <Button
                      variant="ghost"
                      aria-label={`Dismiss ${item.file.name}`}
                      onClick={() => setItems((all) => all.filter((i) => i.id !== item.id))}
                    >
                      Dismiss
                    </Button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
