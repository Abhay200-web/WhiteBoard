import { useQuery } from '@tanstack/react-query';

import type { DiscoveredHost } from './hostAddress';

export type DesktopMode = 'host' | 'client';

/** What the desktop app (apps/desktop) puts on `window.whiteboardDesktop`. */
export interface DesktopBridge {
  /** The first-run choice, or `null` before it was made. */
  getMode(): Promise<DesktopMode | null>;
  setMode(mode: DesktopMode): Promise<void>;
  /** Host mode: starts this PC's Host server, waits until it answers, and returns its address. */
  startHost(): Promise<string>;
  /** Hosts announced on the office network (listens for a few seconds). */
  discoverHosts(): Promise<DiscoveredHost[]>;
  /**
   * Host mode: stops the server, restores backup `name` from `backupDir` (the current data is
   * kept in `restore-previous-*`), starts the server again, and returns the restore's report.
   */
  restoreBackup(backupDir: string, name: string): Promise<string>;
}

/** The desktop bridge, or `undefined` in a plain browser (dev, E2E). */
export function desktopBridge(): DesktopBridge | undefined {
  return (window as unknown as { whiteboardDesktop?: DesktopBridge }).whiteboardDesktop;
}

/** The desktop bridge rejects with a plain string. */
export const desktopErrorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** This PC's mode in the desktop app; `data` stays `undefined` in a browser. */
export function useDesktopMode() {
  const bridge = desktopBridge();
  return useQuery({
    queryKey: ['desktop', 'mode'],
    queryFn: () => bridge!.getMode(),
    enabled: Boolean(bridge),
    staleTime: Infinity,
  });
}
