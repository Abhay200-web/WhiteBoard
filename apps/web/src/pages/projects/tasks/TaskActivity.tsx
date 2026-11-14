import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  commentListSchema,
  taskHistorySchema,
  type Comment,
  type ProjectMember,
  type Task,
  type TaskHistoryEntry,
} from '@whiteboard/core';
import { Button } from '@whiteboard/ui';
import { useRef, useState, type FormEvent } from 'react';

import { useAuth } from '../../../auth/AuthProvider';
import { FormError } from '../../../components/AuthShell';
import { api, errorText } from '../../../lib/api';
import { formatDateTime, PRIORITY_LABEL } from '../format';

type Send = (body: string, mentionIds: string[]) => Promise<unknown>;

/**
 * Text box for a comment. Typing `@` offers the project's people; picking one inserts "@Name"
 * and remembers who, so the Host gets their id. Used to write and to edit.
 */
function CommentBox({
  members,
  initial = '',
  initialMentions = [],
  label,
  submit,
  onSend,
  onCancel,
}: {
  members: ProjectMember[];
  initial?: string;
  initialMentions?: string[];
  label: string;
  submit: string;
  onSend: Send;
  onCancel?: () => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState(initial);
  const [caret, setCaret] = useState(initial.length);
  const [picked, setPicked] = useState(() => new Set(initialMentions));
  const [pending, setPending] = useState(false);

  // The word being typed right before the caret, if it starts with @.
  const typed = /@([^\s@]*)$/.exec(body.slice(0, caret));
  const suggestions = typed
    ? members.filter((m) => m.name.toLowerCase().startsWith(typed[1]!.toLowerCase())).slice(0, 5)
    : [];

  function mention(member: ProjectMember) {
    const start = caret - typed![0].length;
    const insert = `@${member.name} `;
    setBody(body.slice(0, start) + insert + body.slice(caret));
    setCaret(start + insert.length);
    setPicked(new Set(picked).add(member.userId));
    box.current?.focus();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    // Keep only the people whose @Name is still in the text.
    const ids = members
      .filter((m) => picked.has(m.userId) && body.includes(`@${m.name}`))
      .map((m) => m.userId);
    setPending(true);
    try {
      await onSend(body, ids);
      setBody('');
      setPicked(new Set());
    } catch {
      // The caller shows the error; keep the text so it can be sent again.
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <textarea
        ref={box}
        aria-label={label}
        rows={3}
        value={body}
        placeholder="Write a comment. Type @ to mention someone."
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
        onChange={(e) => {
          setBody(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
      />
      {suggestions.length > 0 && (
        <ul aria-label="Mention someone" className="flex flex-wrap gap-1">
          {suggestions.map((m) => (
            <li key={m.userId}>
              <Button variant="secondary" onClick={() => mention(m)}>
                @{m.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="secondary" disabled={!body.trim()} loading={pending}>
          {submit}
        </Button>
      </div>
    </form>
  );
}

/** A task's comments. Members comment; authors edit theirs; authors and managers delete. */
export function TaskComments({
  taskId,
  members,
  canModerate,
}: {
  taskId: string;
  members: ProjectMember[];
  canModerate: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = ['comments', taskId];
  const [editing, setEditing] = useState<string | null>(null);
  const list = useQuery({
    queryKey: key,
    queryFn: () => api(`/tasks/${taskId}/comments`, { schema: commentListSchema }),
  });
  const saved = (comments?: Comment[]) => {
    if (comments) queryClient.setQueryData(key, comments);
    else void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ['history', taskId] });
  };
  const post = useMutation({
    mutationFn: ({ body, mentionIds }: { body: string; mentionIds: string[] }) =>
      api(`/tasks/${taskId}/comments`, {
        method: 'POST',
        body: { body, mentionIds },
        schema: commentListSchema,
      }),
    onSuccess: saved,
  });
  const edit = useMutation({
    mutationFn: ({ id, body, mentionIds }: { id: string; body: string; mentionIds: string[] }) =>
      api(`/comments/${id}`, {
        method: 'PATCH',
        body: { body, mentionIds },
        schema: commentListSchema,
      }),
    onSuccess: (comments) => {
      setEditing(null);
      saved(comments);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/comments/${id}`, { method: 'DELETE' }),
    onSuccess: () => saved(),
  });

  return (
    <div className="flex flex-col gap-3">
      {list.data?.length === 0 && <p className="text-sm text-muted">No comments yet.</p>}
      {list.data && list.data.length > 0 && (
        <ul aria-label="Comments" className="flex flex-col gap-3">
          {list.data.map((c) => (
            <li key={c.id} className="text-sm">
              <p className="text-xs text-muted">
                <span className="font-medium text-text">{c.authorName}</span> ·{' '}
                {formatDateTime(c.createdAt)}
                {c.editedAt !== null && ' (edited)'}
              </p>
              {editing === c.id ? (
                <CommentBox
                  members={members}
                  initial={c.body}
                  initialMentions={c.mentions}
                  label="Edit comment"
                  submit="Save"
                  onSend={(body, mentionIds) => edit.mutateAsync({ id: c.id, body, mentionIds })}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <p className="whitespace-pre-wrap">{c.body}</p>
              )}
              <div className="flex gap-1">
                {c.authorId === user?.id && editing !== c.id && (
                  <Button variant="ghost" onClick={() => setEditing(c.id)}>
                    Edit
                  </Button>
                )}
                {(c.authorId === user?.id || canModerate) && (
                  <Button
                    variant="ghost"
                    aria-label={`Delete comment by ${c.authorName}`}
                    onClick={() => remove.mutate(c.id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <CommentBox
        members={members}
        label="New comment"
        submit="Comment"
        onSend={(body, mentionIds) => post.mutateAsync({ body, mentionIds })}
      />
      <FormError message={errorText(post.error, edit.error, remove.error)} />
    </div>
  );
}

/** One line per change, e.g. "moved it from To do to In progress". */
function describeChange(e: TaskHistoryEntry): string {
  switch (e.event) {
    case 'created':
      return 'created the task';
    case 'status':
      return `moved it from ${e.from} to ${e.to}`;
    case 'assignees':
      return [
        e.added.length > 0 && `assigned ${e.added.join(', ')}`,
        e.removed.length > 0 && `unassigned ${e.removed.join(', ')}`,
      ]
        .filter(Boolean)
        .join(' and ');
    case 'priority':
      return `changed the priority from ${PRIORITY_LABEL[e.from]} to ${PRIORITY_LABEL[e.to]}`;
    case 'due':
      return e.to === null ? 'removed the due date' : `set the due date to ${formatDateTime(e.to)}`;
    case 'file':
      return `${e.added ? 'attached' : 'removed'} ${e.name}`;
    case 'comment':
      return 'commented';
    case 'left': {
      const after = e.to ? `${e.to} took it over` : 'the task is now unassigned';
      return e.auto
        ? `lost access (their end date passed); ${after}`
        : `removed ${e.name} from the workspace; ${after}`;
    }
  }
}

/**
 * The task's history, folded away until opened. It refetches when the task changes (its
 * `updatedAt` or file count), so it stays current while the drawer is open.
 */
export function TaskHistory({ task }: { task: Task }) {
  const history = useQuery({
    queryKey: ['history', task.id, task.updatedAt, task.fileCount],
    queryFn: () => api(`/tasks/${task.id}/history`, { schema: taskHistorySchema }),
  });
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium">
        History{history.data ? ` (${history.data.length})` : ''}
      </summary>
      <ol aria-label="History" className="mt-2 flex flex-col gap-1 text-sm">
        {history.data?.map((e) => (
          <li key={e.id}>
            <span className="font-medium">{e.actorName}</span> {describeChange(e)}
            <span className="text-xs text-muted"> · {formatDateTime(e.at)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
