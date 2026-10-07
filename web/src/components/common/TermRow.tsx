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
      <dt className="text-slate-400">{label}</dt>
      <dd className="tabular-nums text-slate-100">{children}</dd>
      {detail !== undefined && <dd className="tabular-nums text-slate-300">{detail}</dd>}
    </div>
  );
}
