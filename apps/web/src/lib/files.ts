import { apiErrorSchema, fileSchema, type FileInfo } from '@whiteboard/core';

import { ApiError, getHostUrl, getToken, setToken } from './api';

interface UploadControls {
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}

/**
 * Uploads one file with `POST /files`. Uses XMLHttpRequest because `fetch` cannot report upload
 * progress. Rejects with `ApiError` (so the uploader can show the Host's message) or an
 * `AbortError` when cancelled.
 */
export function uploadFile(file: File, { onProgress, signal }: UploadControls): Promise<FileInfo> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${getHostUrl()}/files`);
    const token = getToken();
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let json: unknown = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = fileSchema.safeParse(json);
        return parsed.success
          ? resolve(parsed.data)
          : reject(new ApiError(xhr.status, 'bad_response', 'Unexpected answer from the Host'));
      }
      if (xhr.status === 401 && token) setToken(null); // session ended
      const error = apiErrorSchema.safeParse(json);
      reject(
        new ApiError(
          xhr.status,
          error.success ? error.data.error : 'http_error',
          error.success ? error.data.message : `Upload failed (${xhr.status})`,
        ),
      );
    };
    xhr.onerror = () =>
      reject(new ApiError(0, 'unreachable', 'Cannot reach the Host. Check the connection.'));
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });

    const body = new FormData();
    body.append('file', file, file.name);
    xhr.send(body);
  });
}

/**
 * Downloads a protected file (`/files/:id/content` or `/thumbnail`) with the session token, since
 * `<img src>` and `<video src>` cannot send an Authorization header. Returns a Blob.
 */
export async function fetchFileBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${getHostUrl()}${path}`, {
      signal,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError(0, 'unreachable', 'Cannot reach the Host. Check the connection.');
  }
  if (!res.ok)
    throw new ApiError(res.status, 'http_error', `Could not load the file (${res.status})`);
  return res.blob();
}
