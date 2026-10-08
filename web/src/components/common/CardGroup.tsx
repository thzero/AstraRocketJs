/** One titled card of a form: a heading over a vertically spaced stack. */
export function CardGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-surface p-3 ring-1 ring-line/10">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
