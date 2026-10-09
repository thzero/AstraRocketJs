import type { ReactNode } from 'react';

/**
 * One titled block of the property panel: a rule above, the heading, then the
 * fields. One component, so every block's heading and field spacing match.
 */
export function PropSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-3 border-t border-line/5 pt-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
      {children}
    </div>
  );
}
