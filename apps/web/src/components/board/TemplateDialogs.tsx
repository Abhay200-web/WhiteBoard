import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  boardTemplateListSchema,
  boardTemplateSchema,
  isAdminRole,
  templateCards,
  type BoardTemplate,
  type Card,
} from '@whiteboard/core';
import { Button, Field, Input, Modal, Spinner } from '@whiteboard/ui';
import { useState } from 'react';

import { useAuth } from '../../auth/AuthProvider';
import { api, errorText } from '../../lib/api';

const TEMPLATES = ['board-templates'];
const BLANK = '';

const cardsLabel = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`;

/** Name a new board and pick what it starts with: nothing, or a template's cards. */
export function NewBoardDialog({
  boardId,
  at,
  onClose,
}: {
  boardId: string;
  /** Where the new board goes on this board. */
  at: { x: number; y: number };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [title, setTitle] = useState('New board');
  const [templateId, setTemplateId] = useState(BLANK);
  const templates = useQuery({
    queryKey: TEMPLATES,
    queryFn: () => api('/board-templates', { schema: boardTemplateListSchema }),
  });
  const create = useMutation({
    mutationFn: () =>
      api(`/boards/${boardId}/boards`, {
        method: 'POST',
        body: { title, ...at, ...(templateId && { templateId }) },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['board', boardId] });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/board-templates/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      if (templateId === id) setTemplateId(BLANK);
      return queryClient.invalidateQueries({ queryKey: TEMPLATES });
    },
  });
  const canDelete = (t: BoardTemplate) =>
    !t.builtIn && (t.createdBy === user?.id || isAdminRole(user?.role));

  return (
    <Modal title="New board" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field label="Board name">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Start with</legend>
          {templates.isPending && <Spinner label="Loading templates" />}
          <ul aria-label="Templates" className="flex flex-col gap-1">
            <TemplateChoice
              id={BLANK}
              label="Blank board"
              checked={templateId === BLANK}
              onPick={setTemplateId}
            />
            {templates.data?.map((t) => (
              <TemplateChoice
                key={t.id}
                id={t.id}
                label={t.name}
                detail={
                  t.builtIn
                    ? cardsLabel(t.cardCount)
                    : `${cardsLabel(t.cardCount)}, saved by ${t.createdByName}`
                }
                checked={templateId === t.id}
                onPick={setTemplateId}
                onDelete={canDelete(t) ? () => remove.mutate(t.id) : undefined}
              />
            ))}
          </ul>
        </fieldset>
        {(errorText(create.error) || errorText(remove.error) || errorText(templates.error)) && (
          <p role="alert" className="text-sm text-danger">
            {errorText(create.error) || errorText(remove.error) || errorText(templates.error)}
          </p>
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={!title.trim()} loading={create.isPending}>
            Create board
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TemplateChoice({
  id,
  label,
  detail,
  checked,
  onPick,
  onDelete,
}: {
  id: string;
  label: string;
  detail?: string;
  checked: boolean;
  onPick: (id: string) => void;
  onDelete?: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
      <label className="flex flex-1 items-center gap-2 text-sm">
        <input type="radio" name="template" checked={checked} onChange={() => onPick(id)} />
        <span>{label}</span>
        {detail && <span className="text-xs text-muted">{detail}</span>}
      </label>
      {onDelete && (
        <Button
          type="button"
          variant="ghost"
          aria-label={`Delete template ${label}`}
          onClick={onDelete}
        >
          Delete
        </Button>
      )}
    </li>
  );
}

/**
 * Saves this board's cards as a template for the whole studio. Pictures, files and tasks stay
 * with the project, so the dialog says how many cards are left out.
 */
export function SaveTemplateDialog({
  title,
  cards,
  onClose,
}: {
  title: string;
  cards: readonly Card[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(title);
  const kept = templateCards(cards);
  const left = cards.length - kept.length;
  const save = useMutation({
    mutationFn: () =>
      api('/board-templates', {
        method: 'POST',
        body: { name, cards: kept },
        schema: boardTemplateSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TEMPLATES }),
  });

  return (
    <Modal title="Save as template" onClose={onClose}>
      {save.isSuccess ? (
        <div className="flex flex-col gap-4">
          <p role="status" className="text-sm">
            Saved. “{save.data.name}” is now offered when anyone in the studio adds a board.
          </p>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Template name">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <p className="text-sm text-muted">
            {kept.length === 0
              ? 'This board has no notes, columns, lines or links to keep.'
              : `${cardsLabel(kept.length)} will be kept.`}
            {left > 0 &&
              ` ${left} ${left === 1 ? 'picture, file or task stays' : 'pictures, files and tasks stay'} with this project.`}
          </p>
          {errorText(save.error) && (
            <p role="alert" className="text-sm text-danger">
              {errorText(save.error)}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!name.trim() || kept.length === 0}
              loading={save.isPending}
            >
              Save template
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
