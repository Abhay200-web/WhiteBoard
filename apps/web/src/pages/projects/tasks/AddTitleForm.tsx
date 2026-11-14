import { Button, Input } from '@whiteboard/ui';
import { useState, type FormEvent } from 'react';

/** One-line "type a title, press Add" form. `onAdd` resolves once saved; the field then clears. */
export function AddTitleForm({
  label,
  placeholder,
  button,
  onAdd,
}: {
  label: string;
  placeholder: string;
  button: string;
  onAdd: (title: string) => Promise<unknown>;
}) {
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setPending(true);
    try {
      await onAdd(title.trim());
      setTitle('');
    } catch {
      // The caller shows the error; keep the text so it can be retried.
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-2 flex gap-2">
      <Input
        aria-label={label}
        placeholder={placeholder}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Button type="submit" variant="secondary" disabled={!title.trim()} loading={pending}>
        {button}
      </Button>
    </form>
  );
}
