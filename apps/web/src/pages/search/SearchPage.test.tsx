import { render } from '@testing-library/react';
import type { SearchHit } from '@whiteboard/core';
import { describe, expect, it } from 'vitest';

import { highlight, hitHref } from './SearchPage';

const hit = (kind: SearchHit['kind'], extra: Partial<SearchHit> = {}): SearchHit => ({
  kind,
  id: 'x',
  projectId: 'p1',
  boardId: null,
  title: '',
  snippet: '',
  ...extra,
});

describe('search results', () => {
  it('opens a board or card on its board, and everything else on its project', () => {
    expect(hitHref(hit('project'))).toBe('/projects/p1');
    expect(hitHref(hit('task'))).toBe('/projects/p1');
    expect(hitHref(hit('comment'))).toBe('/projects/p1');
    expect(hitHref(hit('board', { boardId: 'b1' }))).toBe('/boards/b1');
    expect(hitHref(hit('card', { boardId: 'b2' }))).toBe('/boards/b2');
  });

  it('shows the matches in brackets as highlighted text', () => {
    const { container } = render(<p>{highlight('Make it [bold] now')}</p>);
    expect(container.querySelector('mark')?.textContent).toBe('bold');
    expect(container.textContent).toBe('Make it bold now');
  });
});
