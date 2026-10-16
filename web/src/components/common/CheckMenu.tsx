import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface CheckMenuItem {
  key: string;
  label: ReactNode;
  checked: boolean;
}

/**
 * A dropdown of checkboxes on a native `<details>`: the summary is the button,
 * and the panel lists one labeled checkbox per item. `children` render above
 * the items, for an action such as "select all".
 *
 * While open, a pointer press outside it closes it, and Escape closes it and
 * returns focus to the summary. Escape is taken in the capture phase and marked
 * handled (`defaultPrevented`), so the dialog the menu sits in stays open.
 */
export function CheckMenu({
  summary,
  items,
  onToggle,
  width,
  align = 'left',
  className,
  children,
}: {
  summary: ReactNode;
  items: CheckMenuItem[];
  onToggle: (key: string) => void;
  /** The panel's Tailwind width class. */
  width: string;
  /** Which edge the panel hangs from. */
  align?: 'left' | 'right';
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
      summaryRef.current?.focus();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <details
      ref={ref}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className={className ? `relative ${className}` : 'relative'}
    >
      <summary
        ref={summaryRef}
        className="cursor-pointer list-none rounded-lg bg-canvas px-3 py-1.5 text-sm text-ink-strong ring-1 ring-line/10"
      >
        {summary}
      </summary>
      <div
        className={`absolute top-full z-20 mt-1 max-h-64 ${width} overflow-y-auto rounded-lg bg-canvas p-1 shadow-xl ring-1 ring-line/10 ${
          align === 'left' ? 'left-0' : 'right-0'
        }`}
      >
        {children}
        {items.map((it) => (
          <label key={it.key} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-ink hover:bg-raised">
            <input
              type="checkbox"
              checked={it.checked}
              className="accent-accent-500"
              onChange={() => onToggle(it.key)}
            />
            {it.label}
          </label>
        ))}
      </div>
    </details>
  );
}
