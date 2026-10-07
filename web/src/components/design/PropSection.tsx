import type { ReactNode } from 'react';

/**
 * One titled block of the property panel: a rule above, the heading, then the
 * fields. One component, because the copies drifted: one heading was a div two
 * sizes and a shade apart, and one block spaced its fields tighter than the rest.
 */
export function PropSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-3 border-t border-white/5 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </div>
  );
}
