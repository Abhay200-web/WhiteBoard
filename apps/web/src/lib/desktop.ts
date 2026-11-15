import type { DiscoveredHost } from './hostAddress';

export type DesktopMode = 'host' | 'client';

/** What the desktop app (apps/desktop) puts on `window.whiteboardDesktop`. */
export interface DesktopBridge {
  /** The first-run choice, or `null` before it was made. */
  getMode(): Promise<DesktopMode | null>;
  setMode(mode: DesktopMode): Promise<void>;
  /** Host mode: starts this PC's Host server, waits until it answers, and returns its address. */
  startHost(): Promise<string>;
  discoverHosts?(): Promise<DiscoveredHost[]>;
}

/** The desktop bridge, or `undefined` in a plain browser (dev, E2E). */
export function desktopBridge(): DesktopBridge | undefined {
  return (window as unknown as { whiteboardDesktop?: DesktopBridge }).whiteboardDesktop;
}
