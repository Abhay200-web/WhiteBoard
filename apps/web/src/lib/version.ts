/** The release of this web app. */
export const APP_VERSION = __APP_VERSION__;

/**
 * Whether this app can talk to a Host on `hostVersion`. Releases share the API while the major
 * and minor numbers match; a patch release is always compatible.
 */
export function isCompatibleRelease(hostVersion: string, appVersion = APP_VERSION): boolean {
  const majorMinor = (version: string) => version.split('.', 2).join('.');
  return majorMinor(hostVersion) === majorMinor(appVersion);
}
