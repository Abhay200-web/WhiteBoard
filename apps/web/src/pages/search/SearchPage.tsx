import { useQuery } from '@tanstack/react-query';
import { searchResultSchema, type SearchHit } from '@whiteboard/core';
import { Button, Input } from '@whiteboard/ui';
import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { api, errorText } from '../../lib/api';

const KIND_LABEL: Record<SearchHit['kind'], string> = {
  project: 'Project',
  task: 'Task',
  comment: 'Comment',
  board: 'Board',
  card: 'Card',
};

/** Where a hit leads: boards and cards open on their board, everything else on its project. */
export function hitHref(hit: SearchHit): string {
  return hit.kind === 'board' || hit.kind === 'card'
    ? `/boards/${hit.boardId}`
    : `/projects/${hit.projectId}`;
}

/** The snippet with the matches (written in [brackets] by the Host) shown as highlighted text. */
export function highlight(snippet: string): ReactNode[] {
  return snippet.split(/(\[[^\]]*\])/).map((part, i) =>
    part.startsWith('[') && part.endsWith(']') ? (
      <mark key={i} className="rounded bg-accent/20 px-0.5">
        {part.slice(1, -1)}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

/** Search across the projects, tasks, comments, boards and cards the person can see. */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [text, setText] = useState(q);
  const results = useQuery({
    queryKey: ['search', q],
    queryFn: () => api(`/search?q=${encodeURIComponent(q)}`, { schema: searchResultSchema }),
    enabled: q.trim().length > 0,
  });

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Search</h1>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(text.trim() ? { q: text.trim() } : {});
        }}
      >
        <Input
          aria-label="Search for"
          placeholder="Projects, tasks, comments, boards"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit">Search</Button>
      </form>

      {results.isError && (
        <p role="alert" className="text-sm text-danger">
          {errorText(results.error)}
        </p>
      )}
      {q && results.data && results.data.length === 0 && (
        <p className="text-sm text-muted">Nothing matches “{q}”.</p>
      )}
      {results.data && results.data.length > 0 && (
        <ul aria-label="Search results" className="flex flex-col gap-2">
          {results.data.map((hit) => (
            <li key={`${hit.kind}-${hit.id}`}>
              <Link
                to={hitHref(hit)}
                className="block rounded-md border border-line px-4 py-3 hover:bg-surface-2"
              >
                <span className="text-xs text-muted">{KIND_LABEL[hit.kind]}</span>
                <span className="block font-medium">{hit.title || KIND_LABEL[hit.kind]}</span>
                {hit.snippet && (
                  <span className="block text-sm text-muted">{highlight(hit.snippet)}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
