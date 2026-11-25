import { describe, expect, it } from 'vitest';

import { isCompatibleRelease } from './version';

describe('isCompatibleRelease', () => {
  it('accepts a Host on the same minor release, whatever the patch', () => {
    expect(isCompatibleRelease('0.1.7', '0.1.0')).toBe(true);
    expect(isCompatibleRelease('0.1.0', '0.1.0')).toBe(true);
  });

  it('refuses a Host on another minor or major release', () => {
    expect(isCompatibleRelease('0.2.0', '0.1.0')).toBe(false);
    expect(isCompatibleRelease('1.1.0', '1.0.9')).toBe(false);
  });

  it('compares against this build when no version is given', () => {
    expect(isCompatibleRelease('0.1.0')).toBe(true);
  });
});
