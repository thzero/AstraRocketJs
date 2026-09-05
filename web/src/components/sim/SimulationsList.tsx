import { useTranslation } from 'react-i18next';
import type { Simulation } from '../../services/simulations';
import type { MotorSpec } from '../../engine/openRocketEngine';
import { fmtNum } from '../../i18n/format';

/** "Estes C6" — manufacturer + designation, or just the designation if unknown. */
function motorLabel(m: MotorSpec): string {
  return m.manufacturer ? `${m.manufacturer} ${m.designation}` : m.designation;
}

/**
 * The simulations accordion. Collapsed (the default), it shows just the selected
 * simulation — its config opens below. Expanded, it lists every simulation over
 * the shared design (name + motor); picking one selects it and collapses back.
 * Add / duplicate / delete live in the expanded list.
 */
export function SimulationsList({
  sims,
  activeId,
  open,
  onToggleOpen,
  onSelect,
  onAdd,
  onDuplicate,
  onDelete,
}: {
  sims: Simulation[];
  activeId: string;
  open: boolean;
  onToggleOpen: () => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const active = sims.find((s) => s.id === activeId) ?? sims[0]!;
  const summaryOf = (s: Simulation) => (s.result ? `${fmtNum(s.result.summary.maxAltitude, 0)} m` : t('sims.notRun'));

  return (
    <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          onClick={onToggleOpen}
          aria-expanded={open}
          className="-ml-1 flex items-center gap-2 rounded-md px-1.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300 hover:bg-slate-800 hover:text-slate-100"
        >
          <span className="text-base leading-none text-sky-400">{open ? '▾' : '▸'}</span>
          {t('sims.title')}
          {!open && sims.length > 1 && <span className="text-slate-500">({sims.length})</span>}
        </button>
        <button
          onClick={onAdd}
          className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-sky-300 ring-1 ring-white/10 hover:bg-slate-700"
        >
          {t('sims.new')}
        </button>
      </div>

      {open ? (
        <ul className="space-y-1">
          {sims.map((s) => {
            const isActive = s.id === activeId;
            return (
              <li
                key={s.id}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${isActive ? 'bg-sky-600/20 ring-1 ring-inset ring-sky-500/40' : 'hover:bg-slate-800'}`}
              >
                <button onClick={() => onSelect(s.id)} className="min-w-0 flex-1 text-left">
                  <div className={`truncate text-sm font-medium ${isActive ? 'text-sky-100' : 'text-slate-200'}`}>
                    {s.name}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">{motorLabel(s.motor)}</div>
                </button>
                <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{summaryOf(s)}</span>
                <button
                  onClick={() => onDuplicate(s.id)}
                  title={t('sims.duplicate')}
                  aria-label={t('sims.duplicate')}
                  className="shrink-0 rounded px-1 text-xs text-slate-400 hover:bg-slate-700 hover:text-sky-300"
                >
                  ⧉
                </button>
                {sims.length > 1 && (
                  <button
                    onClick={() => onDelete(s.id)}
                    title={t('sims.delete')}
                    className="shrink-0 rounded px-1 text-xs text-red-400 hover:bg-slate-700"
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <button
          onClick={onToggleOpen}
          className="flex w-full items-center gap-2 rounded-md bg-sky-600/20 px-2 py-1.5 text-left ring-1 ring-inset ring-sky-500/40"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-sky-100">{active.name}</div>
            <div className="truncate text-[11px] text-slate-500">{motorLabel(active.motor)}</div>
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{summaryOf(active)}</span>
        </button>
      )}
    </section>
  );
}
