import type { SelectHTMLAttributes } from 'react';

import { cn } from './cn';

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 w-full rounded-md border border-line bg-surface px-2 text-sm text-text',
        'focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50',
        className,
      )}
      {...rest}
    />
  );
}
