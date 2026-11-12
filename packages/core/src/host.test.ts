import { describe, expect, it } from 'vitest';

import { hostInfoSchema } from './host';

describe('hostInfoSchema', () => {
  it('accepts a Host before setup', () => {
    const info = { workspaceName: null, serverVersion: '0.1.0', setupDone: false };
    expect(hostInfoSchema.parse(info)).toEqual(info);
  });

  it('rejects a missing server version', () => {
    expect(() => hostInfoSchema.parse({ workspaceName: 'Studio', setupDone: true })).toThrow();
  });
});
