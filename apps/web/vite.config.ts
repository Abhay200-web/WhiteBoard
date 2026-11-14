import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const HOST = process.env.WB_DEV_HOST_URL ?? 'http://127.0.0.1:47800';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In dev and E2E the browser talks to the Host through the dev server, so no CORS is needed.
    // Page navigations (Accept: text/html, e.g. reloading /setup) must get the app, not the Host.
    proxy: Object.fromEntries(
      [
        '/host',
        '/setup',
        '/auth',
        '/members',
        '/invites',
        '/files',
        '/backups',
        '/projects',
        '/people',
        '/tasks',
        '/subtasks',
        '/me/',
        '/comments',
        '/notifications',
        '/events',
      ].map((p) => [
        p,
        {
          target: HOST,
          changeOrigin: true,
          ws: p === '/events', // the live connection is a WebSocket

          bypass: (req: { headers: { accept?: string } }) =>
            req.headers.accept?.includes('text/html') ? '/index.html' : undefined,
        },
      ]),
    ),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
