import { hostname } from 'node:os';

import { Bonjour } from 'bonjour-service';

/** mDNS service type, so clients can find the Host as `_whiteboard._tcp`. */
export const SERVICE_TYPE = 'whiteboard';

/**
 * Announces this Host on the LAN. Discovery is a convenience: if mDNS is blocked or fails,
 * the Host keeps running and clients connect by IP. Returns a function that stops announcing.
 */
export function announceHost(
  { port, version }: { port: number; version: string },
  onError?: (err: unknown) => void,
): () => void {
  try {
    const bonjour = new Bonjour(undefined, (err: unknown) => onError?.(err));
    bonjour.publish({
      name: `Whiteboard on ${hostname()}`,
      type: SERVICE_TYPE,
      port,
      txt: { version },
    });
    return () => {
      bonjour.unpublishAll(() => bonjour.destroy());
    };
  } catch (err) {
    onError?.(err);
    return () => undefined;
  }
}
