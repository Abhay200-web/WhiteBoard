import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { mockHost, OWNER, renderApp } from '../test/render';

describe('update banner', () => {
  it('asks for an update when the Host runs another minor release', async () => {
    mockHost({ serverVersion: '0.2.0' }, OWNER);
    renderApp('/', 'tok');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Update needed: this app is version 0.1.0 but the Host runs 0.2.0',
    );
  });
});
