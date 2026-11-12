import { describe, expect, it } from 'vitest';

import { changePasswordRequestSchema, setupRequestSchema, signInRequestSchema } from './auth';

describe('auth contracts', () => {
  it('normalises the email on setup', () => {
    const parsed = setupRequestSchema.parse({
      workspaceName: ' Studio ',
      ownerName: 'Owner',
      email: '  Owner@Studio.TEST ',
      password: 'correct-horse-battery',
    });
    expect(parsed.email).toBe('owner@studio.test');
    expect(parsed.workspaceName).toBe('Studio');
  });

  it('rejects short passwords on setup and change-password', () => {
    expect(() =>
      setupRequestSchema.parse({
        workspaceName: 'S',
        ownerName: 'O',
        email: 'o@s.test',
        password: 'short',
      }),
    ).toThrow();
    expect(() =>
      changePasswordRequestSchema.parse({ currentPassword: 'x', newPassword: 'short' }),
    ).toThrow();
  });

  it('does not enforce length on sign-in (legacy/temporary passwords)', () => {
    expect(signInRequestSchema.parse({ email: 'a@b.test', password: 'x' }).password).toBe('x');
  });
});
