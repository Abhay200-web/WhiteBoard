import { useHostInfo } from '../auth/guards';
import { APP_VERSION, isCompatibleRelease } from '../lib/version';

/** Shown when this copy of the app is a different release from the Host (for example after a Host update). */
export function UpdateBanner() {
  const info = useHostInfo();
  const hostVersion = info.data?.serverVersion;
  if (!hostVersion || isCompatibleRelease(hostVersion)) return null;
  return (
    <div role="alert" className="bg-accent px-4 py-1.5 text-center text-sm text-accent-fg">
      Update needed: this app is version {APP_VERSION} but the Host runs {hostVersion}. Reload the
      page. If the message stays, install the same version as the Host.
    </div>
  );
}
