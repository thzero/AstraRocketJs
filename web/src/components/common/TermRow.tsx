/** One term and its value in a `<dl>`. Renders `<dt>`/`<dd>`, so it must sit
 *  inside a `<dl>`. `detail` adds a second, dimmer `<dd>` under the value. */
export function TermRow({
  label,
  children,
  detail,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  detail?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tabular-nums text-ink-strong">{children}</dd>
      {detail !== undefined && <dd className="tabular-nums text-ink-soft">{detail}</dd>}
    </div>
  );
}
