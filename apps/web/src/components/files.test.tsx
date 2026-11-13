import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileUploader } from '@whiteboard/ui';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setToken } from '../lib/api';
import { uploadFile } from '../lib/files';
import { server } from '../test/setup';
import { FilePreview, previewKind } from './FilePreview';

vi.mock('./PdfViewer', () => ({
  default: ({ name }: { name: string }) => <div>PDF viewer: {name}</div>,
}));

const FILE_INFO = {
  id: 'f1',
  name: 'logo.png',
  mimeType: 'image/png',
  size: 5,
  sha256: 'a'.repeat(64),
  hasThumbnail: true,
  uploadedBy: 'u1',
  createdAt: 1,
};

const png = (name = 'logo.png', bytes = 'hello') => new File([bytes], name, { type: 'image/png' });

describe('FileUploader', () => {
  it('uploads picked files, shows progress, and reports the result', async () => {
    let report: (fraction: number) => void = () => undefined;
    let finish: (value: string) => void = () => undefined;
    const upload = vi.fn(
      (_file: File, controls: { onProgress: (f: number) => void }) =>
        new Promise<string>((resolve) => {
          report = controls.onProgress;
          finish = resolve;
        }),
    );
    const onUploaded = vi.fn();
    const user = userEvent.setup();
    render(<FileUploader upload={upload} onUploaded={onUploaded} />);

    await user.upload(screen.getByLabelText(/Choose files/), png());
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('progressbar', { name: 'Uploading logo.png' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );

    report(0.4);
    await waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40'),
    );
    finish('stored');
    expect(await screen.findByText('Uploaded')).toBeInTheDocument();
    expect(onUploaded).toHaveBeenCalledWith(
      'stored',
      expect.objectContaining({ name: 'logo.png' }),
    );
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('cancels an upload, then retries it', async () => {
    let attempt = 0;
    const upload = vi.fn(
      (_file: File, { signal }: { signal: AbortSignal }) =>
        new Promise<string>((resolve, reject) => {
          attempt++;
          if (attempt === 2) return resolve('ok');
          signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
        }),
    );
    const user = userEvent.setup();
    render(<FileUploader upload={upload} />);
    await user.upload(screen.getByLabelText(/Choose files/), png());

    await user.click(screen.getByRole('button', { name: 'Cancel logo.png' }));
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry logo.png' }));
    expect(await screen.findByText('Uploaded')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('shows the error from the Host and lets you retry or dismiss', async () => {
    const upload = vi
      .fn<(f: File) => Promise<string>>()
      .mockRejectedValueOnce(new Error('This file type is not allowed'))
      .mockResolvedValueOnce('ok');
    const user = userEvent.setup();
    render(<FileUploader upload={upload} />);
    await user.upload(screen.getByLabelText(/Choose files/), png('bad.png'));
    expect(await screen.findByRole('alert')).toHaveTextContent('This file type is not allowed');

    await user.click(screen.getByRole('button', { name: 'Retry bad.png' }));
    expect(await screen.findByText('Uploaded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss bad.png' }));
    expect(screen.queryByRole('list', { name: 'Uploads' })).not.toBeInTheDocument();
  });

  it('refuses files over the size limit without sending them', async () => {
    const upload = vi.fn();
    const user = userEvent.setup();
    render(<FileUploader upload={upload} maxBytes={4} />);
    await user.upload(screen.getByLabelText(/Choose files/), png('big.png', 'too long'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too large');
    expect(upload).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument();
  });

  it('accepts several files at once', async () => {
    const upload = vi.fn().mockResolvedValue('ok');
    const user = userEvent.setup();
    render(<FileUploader upload={upload} />);
    await user.upload(screen.getByLabelText(/Choose files/), [png('a.png'), png('b.png')]);
    await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(2));
  });
});

describe('uploadFile', () => {
  beforeEach(() => setToken('tok'));

  it('posts multipart data with the session token and parses the file info', async () => {
    let auth: string | null = null;
    let sawFile = false;
    server.use(
      http.post('*/files', async ({ request }) => {
        auth = request.headers.get('authorization');
        const raw = await request.text();
        sawFile = raw.includes('name="file"') && raw.includes('filename="logo.png"');
        return HttpResponse.json(FILE_INFO, { status: 201 });
      }),
    );
    const info = await uploadFile(png(), {
      onProgress: () => undefined,
      signal: new AbortController().signal,
    });
    expect(info.id).toBe('f1');
    expect(auth).toBe('Bearer tok');
    expect(sawFile).toBe(true);
  });

  it('turns Host errors into messages', async () => {
    server.use(
      http.post('*/files', () =>
        HttpResponse.json(
          { error: 'unsupported_file', message: 'This file type is not allowed' },
          { status: 415 },
        ),
      ),
    );
    await expect(
      uploadFile(png(), { onProgress: () => undefined, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ status: 415, message: 'This file type is not allowed' });
  });

  it('does not start when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      uploadFile(png(), { onProgress: () => undefined, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('previews', () => {
  beforeEach(() => {
    setToken('tok');
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
  });

  const renderPreview = (props: { name: string; mimeType: string }) =>
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <FilePreview fileId="f1" {...props} />
      </QueryClientProvider>,
    );

  it('picks the preview by type', () => {
    expect(previewKind('image/png')).toBe('image');
    expect(previewKind('image/heic')).toBe('other');
    expect(previewKind('application/pdf')).toBe('pdf');
    expect(previewKind('video/mp4')).toBe('video');
    expect(previewKind('video/quicktime')).toBe('other');
    expect(previewKind('text/plain')).toBe('other');
  });

  it('shows an image fetched with the session token', async () => {
    let auth: string | null = null;
    server.use(
      http.get('*/files/f1/content', ({ request }) => {
        auth = request.headers.get('authorization');
        return new HttpResponse('img', { headers: { 'content-type': 'image/png' } });
      }),
    );
    renderPreview({ name: 'logo.png', mimeType: 'image/png' });
    expect(await screen.findByRole('img', { name: 'logo.png' })).toHaveAttribute(
      'src',
      'blob:test',
    );
    expect(auth).toBe('Bearer tok');
  });

  it('shows a video player and the PDF viewer', async () => {
    server.use(http.get('*/files/f1/content', () => new HttpResponse('data')));
    const video = renderPreview({ name: 'cut.mp4', mimeType: 'video/mp4' });
    expect(await screen.findByLabelText('cut.mp4')).toBeInstanceOf(HTMLVideoElement);
    video.unmount();
    renderPreview({ name: 'brief.pdf', mimeType: 'application/pdf' });
    expect(await screen.findByText('PDF viewer: brief.pdf')).toBeInTheDocument();
  });

  it('offers a download for other types', async () => {
    server.use(http.get('*/files/f1/content', () => new HttpResponse('a,b')));
    renderPreview({ name: 'data.csv', mimeType: 'text/csv' });
    expect(await screen.findByText(/No preview/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download data.csv' })).toBeInTheDocument();
  });

  it('explains when the file is not available', async () => {
    server.use(
      http.get('*/files/f1/content', () =>
        HttpResponse.json({ error: 'not_found', message: 'File not found' }, { status: 404 }),
      ),
    );
    renderPreview({ name: 'x.png', mimeType: 'image/png' });
    expect(await screen.findByRole('alert')).toHaveTextContent('not available to you');
  });
});
