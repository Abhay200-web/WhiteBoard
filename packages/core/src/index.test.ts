import { describe, expect, it } from 'vitest';

import { APP_NAME, HOST_PORT } from './index';

describe('core constants', () => {
  it('exposes the app name and Host port', () => {
    expect(APP_NAME).toBe('Whiteboard');
    expect(HOST_PORT).toBe(47800);
  });
});
