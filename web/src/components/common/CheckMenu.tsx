import type { ReactNode } from 'react';

export interface CheckMenuItem {
  key: string;
  label: ReactNode;
  checked: boolean;
}

/**
 * A dropdown of checkboxes on a native `<details>`: the summary is the button,
 * and the panel lists one labeled checkbox per item. `children` render above
 * the items, for an action such as "select all".
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
  return (
    <details className={className ? `relative ${className}` : 'relative'}>
      <summary className="cursor-pointer list-none rounded-lg bg-canvas px-3 py-1.5 text-sm text-ink-strong ring-1 ring-line/10">
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
