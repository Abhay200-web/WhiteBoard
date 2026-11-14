import type { ComponentProps } from 'react';

import { cn } from './cn';

/** Text input. Takes every `<input>` prop, including `ref` (React 19 passes it as a prop). */
export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-text',
        'placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent',
        'disabled:opacity-50 aria-[invalid=true]:border-danger',
        className,
      )}
      {...rest}
    />
  );
}
