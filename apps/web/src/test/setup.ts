import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

// jsdom has no layout. ProseMirror (the rich-text editor) asks for these while it works.
const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
const zeroRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
Range.prototype.getClientRects = noRects as unknown as typeof Range.prototype.getClientRects;
Range.prototype.getBoundingClientRect =
  zeroRect as unknown as typeof Range.prototype.getBoundingClientRect;
Element.prototype.getClientRects ??= noRects as unknown as typeof Element.prototype.getClientRects;
document.elementFromPoint ??= () => null;

/** API mock server. Tests add handlers with `server.use(...)`; the Host is never contacted. */
export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());
