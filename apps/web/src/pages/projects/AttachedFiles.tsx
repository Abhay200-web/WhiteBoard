import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { attachedFileListSchema, type AttachedFile } from '@whiteboard/core';
import { Button, FileUploader, Modal, Spinner } from '@whiteboard/ui';
import { useState } from 'react';

import { FormError } from '../../components/AuthShell';
import { FilePreview, FileThumbnail } from '../../components/FilePreview';
import { api, errorText } from '../../lib/api';
import { uploadFile } from '../../lib/files';
import { formatFileSize } from './format';

/**
 * Files attached to a project or a task. `path` is the list endpoint (`/projects/:id/files` or
 * `/tasks/:id/files`), which also takes `POST {fileId}` and `DELETE <path>/:fileId`.
 * Everyone who sees the list can open the files; `canManage` adds upload and remove.
 */
export function AttachedFiles({
  path,
  label,
  canManage,
  onChange,
}: {
  path: string;
  label: string;
  canManage: boolean;
  onChange?: () => void;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<AttachedFile | null>(null);
  const files = useQuery({
    queryKey: ['files', path],
    queryFn: () => api(path, { schema: attachedFileListSchema }),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['files', path] });
    onChange?.();
  };

  const attach = useMutation({
    mutationFn: (fileId: string) => api(path, { method: 'POST', body: { fileId } }),
    onSuccess: refresh,
  });
  const detach = useMutation({
    mutationFn: (fileId: string) => api(`${path}/${fileId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  return (
    <>
      {files.isPending && <Spinner />}
      {files.data && files.data.length === 0 && (
        <p className="mt-2 text-sm text-muted">No files yet.</p>
      )}
      {files.data && files.data.length > 0 && (
        <ul aria-label={label} className="mt-2 divide-y divide-line">
          {files.data.map((f) => (
            <li key={f.fileId} className="flex items-center gap-3 py-2 text-sm">
              {f.hasThumbnail && <FileThumbnail fileId={f.fileId} name={f.name} />}
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-medium text-accent underline"
                onClick={() => setOpen(f)}
              >
                {f.name}
              </button>
              <span className="shrink-0 text-muted">{formatFileSize(f.size)}</span>
              {canManage && (
                <Button
                  variant="ghost"
                  aria-label={`Remove file ${f.name}`}
                  loading={detach.isPending && detach.variables === f.fileId}
                  onClick={() => detach.mutate(f.fileId)}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <FormError message={errorText(attach.error, detach.error)} />
      {canManage && (
        <FileUploader
          className="mt-4"
          upload={uploadFile}
          onUploaded={(info) => attach.mutate(info.id)}
        />
      )}
      {open && (
        <Modal title={open.name} onClose={() => setOpen(null)}>
          <FilePreview fileId={open.fileId} name={open.name} mimeType={open.mimeType} />
          <div className="mt-4 flex justify-end">
            <Button variant="secondary" onClick={() => setOpen(null)}>
              Close
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
