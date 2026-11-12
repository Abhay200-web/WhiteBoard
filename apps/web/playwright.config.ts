import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { defineConfig } from '@playwright/test';

// Every run gets an empty Host data folder, so the setup wizard is always the first screen.
const dataDir = mkdtempSync(path.join(tmpdir(), 'wb-e2e-'));

// E2E runs the real web app against a real Host on a temp data dir.
// First run: `pnpm exec playwright install chromium`.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'pnpm --filter @whiteboard/server start',
      url: 'http://127.0.0.1:47800/host/info',
      env: { WB_HOST: '127.0.0.1', WB_DATA_DIR: dataDir },
      reuseExistingServer: !process.env.CI,
      cwd: '../..',
    },
    {
      command: 'pnpm exec vite --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
