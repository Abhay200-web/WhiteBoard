import type { LiveStatus } from '../lib/events';

/** Shown while the live connection to the Host is being restored. */
export function ConnectionBanner({ status }: { status: LiveStatus }) {
  if (status !== 'reconnecting') return null;
  return (
    <div role="status" className="bg-accent px-4 py-1.5 text-center text-sm text-accent-fg">
      Reconnecting to the Host... What others change will show again once it is back.
    </div>
  );
}
