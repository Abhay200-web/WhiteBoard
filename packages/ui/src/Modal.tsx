import { useEffect, useId, useRef, type ReactNode } from 'react';

import { cn } from './cn';

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Width; `lg` suits longer forms. Tall content scrolls inside at any size. */
  size?: 'md' | 'lg';
}

const SIZE = { md: 'max-w-md', lg: 'max-w-2xl' } as const;

/** Accessible modal: Escape and backdrop click close it, focus moves inside on open. */
export function Modal({ title, onClose, children, size = 'md' }: ModalProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
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
        className={cn(
          'max-h-[90vh] w-full overflow-y-auto rounded-lg border border-line bg-surface p-6 shadow-lg outline-none',
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
