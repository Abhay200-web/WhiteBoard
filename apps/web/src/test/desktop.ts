import { vi } from 'vitest';

import type { DesktopBridge, DesktopMode } from '../lib/desktop';

export const LOCAL_HOST = 'http://127.0.0.1:47800';

/**
 * Stands in for the desktop app's `window.whiteboardDesktop`, remembering the chosen mode like the
 * real one. `setup.ts` removes it after each test.
 */
export function fakeDesktop(mode: DesktopMode | null, overrides: Partial<DesktopBridge> = {}) {
  let saved = mode;
  const bridge = {
    getMode: vi.fn(async () => saved),
    setMode: vi.fn(async (next: DesktopMode) => {
      saved = next;
    }),
    startHost: vi.fn(async () => LOCAL_HOST),
    discoverHosts: vi.fn(async () => []),
    restoreBackup: vi.fn(async () => 'Restored'),
    notify: vi.fn(async () => {}),
    ...overrides,
  };
  (window as unknown as { whiteboardDesktop?: DesktopBridge }).whiteboardDesktop = bridge;
  return bridge;
}
