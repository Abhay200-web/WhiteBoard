import { useId, type ReactElement, type ReactNode } from 'react';

import { cloneElement } from 'react';

export interface FieldProps {
  label: string;
  error?: string | null;
  hint?: string;
  /** A single form control; it receives `id`, `aria-invalid` and `aria-describedby`. */
  children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
}

/** Label + control + hint/error, wired together for screen readers. */
export function Field({ label, error, hint, children }: FieldProps): ReactNode {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      {cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': note ? noteId : undefined,
      })}
      {note && (
        <p id={noteId} className={error ? 'text-xs text-danger' : 'text-xs text-muted'}>
          {note}
        </p>
      )}
    </div>
  );
}
