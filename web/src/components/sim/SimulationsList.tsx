import { useTranslation } from 'react-i18next';
import type { Simulation } from '../../services/simulations';
import { fmtNum } from '../../i18n/format';

/**
 * The list of simulations (OpenRocket-style): each row is a named flight setup
 * over the shared design. The active one is editable in place and drives the
 * motor / launch editors + stability readout below. Add / select / rename / delete.
 */
export function SimulationsList({ sims, activeId, onSelect, onAdd, onDelete, onRename }: {
  sims: Simulation[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('sims.title')}</h2>
        <button onClick={onAdd} className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-sky-300 ring-1 ring-white/10 hover:bg-slate-700">
          {t('sims.new')}
        </button>
      </div>
      <ul className="space-y-1">
        {sims.map((s) => {
          const active = s.id === activeId;
          const summary = s.result ? `${fmtNum(s.result.summary.maxAltitude, 0)} m` : t('sims.notRun');
          return (
            <li
              key={s.id}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${active ? 'bg-sky-600/20 ring-1 ring-inset ring-sky-500/40' : 'hover:bg-slate-800'}`}
            >
              {active ? (
                <input
                  value={s.name} onChange={(e) => onRename(s.id, e.target.value)}
                  aria-label={t('sims.rename')} title={t('sims.rename')}
                  className="min-w-0 flex-1 rounded bg-slate-950/70 px-1.5 py-0.5 text-sm font-medium text-sky-100 ring-1 ring-white/10 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              ) : (
                <button onClick={() => onSelect(s.id)} className="min-w-0 flex-1 truncate text-left text-sm text-slate-200">
                  {s.name}
                </button>
              )}
              <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{summary}</span>
              {sims.length > 1 && (
                <button onClick={() => onDelete(s.id)} title={t('sims.delete')} className="shrink-0 rounded px-1 text-xs text-red-400 hover:bg-slate-700">✕</button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
