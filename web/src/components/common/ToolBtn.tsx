/**
 * A pane toolbar button: New, Duplicate, Delete and their neighbors.
 *
 * Shared by the toolbars that sit at the top of a workbench pane (the
 * simulations table, the flight configurations), because two toolbars doing the
 * same job in two shapes read as two different kinds of control. `danger` is for
 * the one that destroys something.
 */
export function ToolBtn({
  children,
  onClick,
  disabled,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium ring-1 ring-white/10 disabled:cursor-not-allowed disabled:text-slate-600 ${
        danger ? 'bg-slate-800 text-red-300 hover:bg-slate-700' : 'bg-slate-800 text-sky-300 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
