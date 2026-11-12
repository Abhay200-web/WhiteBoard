import { HOST_PORT, hostInfoSchema, type HostInfo } from '@whiteboard/core';

/**
 * Turns what a person types ("192.168.1.20", "office-pc:47800", "http://10.0.0.5") into a Host URL.
 * Returns `null` if it cannot be a valid address.
 */
export function normalizeHostAddress(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    if (!url.port) url.port = String(HOST_PORT);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** Asks the Host at `url` who it is. Throws if it is unreachable or not a Whiteboard Host. */
export async function probeHost(url: string, signal?: AbortSignal): Promise<HostInfo> {
  const res = await fetch(`${url}/host/info`, { signal });
  if (!res.ok) throw new Error('not a Whiteboard Host');
  return hostInfoSchema.parse(await res.json());
}

export interface DiscoveredHost {
  name: string;
  url: string;
}

/**
 * Hosts announced on the LAN (mDNS `_whiteboard._tcp`). A browser cannot do mDNS, so this only
 * returns results inside the desktop app, which exposes `window.whiteboardDesktop.discoverHosts`.
 */
export async function discoverHosts(): Promise<DiscoveredHost[]> {
  const bridge = (
    window as unknown as { whiteboardDesktop?: { discoverHosts?: () => Promise<DiscoveredHost[]> } }
  ).whiteboardDesktop;
  if (!bridge?.discoverHosts) return [];
  try {
    return await bridge.discoverHosts();
  } catch {
    return [];
  }
}
