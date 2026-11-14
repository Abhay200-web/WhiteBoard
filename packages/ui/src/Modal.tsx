import { useEffect, useId, useRef, type ReactNode } from 'react';

import { cn } from './cn';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Width; `lg` suits longer forms. Tall content scrolls inside at any size. */
  size?: 'md' | 'lg';
  /** `right` slides in as a full-height side panel (a drawer) instead of a centred box. */
  placement?: 'center' | 'right';
}

const SIZE = { md: 'max-w-md', lg: 'max-w-2xl' } as const;
const PLACEMENT = {
  center: { backdrop: 'grid place-items-center p-4', panel: 'max-h-[90vh] rounded-lg border' },
  right: { backdrop: 'flex justify-end', panel: 'h-full border-l' },
} as const;

/**
 * Accessible modal: Escape and backdrop click close it, focus moves inside on open and back
 * afterwards. Escape is handled on the panel and stopped there, so in nested modals (a file
 * preview inside the task drawer) only the top one closes.
 */
export function Modal({ title, onClose, children, size = 'md', placement = 'center' }: ModalProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  // Once on open, not on every render: re-running would pull focus out of the field in use.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <div
      className={cn('fixed inset-0 z-50 bg-black/50', PLACEMENT[placement].backdrop)}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          onClose();
        }}
        className={cn(
          'w-full overflow-y-auto border-line bg-surface p-6 shadow-lg outline-none',
          PLACEMENT[placement].panel,
          SIZE[size],
        )}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
