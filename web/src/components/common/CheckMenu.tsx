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
      <summary className="cursor-pointer list-none rounded-lg bg-slate-950 px-3 py-1.5 text-sm text-slate-100 ring-1 ring-white/10">
        {summary}
      </summary>
      <div
        className={`absolute top-full z-20 mt-1 max-h-64 ${width} overflow-y-auto rounded-lg bg-slate-950 p-1 shadow-xl ring-1 ring-white/10 ${
          align === 'left' ? 'left-0' : 'right-0'
        }`}
      >
        {children}
        {items.map((it) => (
          <label
            key={it.key}
            className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-200 hover:bg-slate-800"
          >
            <input type="checkbox" checked={it.checked} className="accent-sky-500" onChange={() => onToggle(it.key)} />
            {it.label}
          </label>
        ))}
      </div>
    </details>
  );
}
