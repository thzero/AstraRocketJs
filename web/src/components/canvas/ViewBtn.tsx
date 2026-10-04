/** Small overlay button for the 2D view presets (Side / Aft / Reset) and the
 *  CG/CP · Info view toggles. */
export function ViewBtn({
  active,
  onClick,
  title,
  label,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title?: string;
  /** Accessible name, for a button whose content is a bare glyph. */
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={label}
      aria-pressed={active}
      className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-white/10 ${active ? 'bg-sky-600 text-white' : 'bg-slate-800/90 text-slate-200'}`}
    >
      {children}
    </button>
  );
}
