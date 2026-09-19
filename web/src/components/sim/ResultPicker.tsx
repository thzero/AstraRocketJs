import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive } from '../../state/store';

/**
 * Which flight the Results tab is reading — and the pane's heading.
 *
 * It IS the heading rather than sitting beside one: a title naming the flight
 * and a dropdown showing the same name next to it said one thing twice.
 *
 * ONE RUN, ONE NAME. The choice is offered only when the last run flew more than
 * one simulation, and then it lists exactly those. It used to count simulations
 * that HAVE a result, which is a different thing entirely: results persist, so
 * running one simulation after having run another last week put a dropdown on
 * screen for a single run. An `h2` either way, so the pane keeps a landmark a
 * screen reader can jump to.
 *
 * A picker of its own, not the Simulations table's tick boxes. The ticks answer
 * "which rows should Run fly"; this answers "which flight am I reading". Those
 * are different questions asked at different moments, and sharing one control
 * meant that reading a result silently re-armed the Run button, and that ticking
 * rows to fly them yanked the charts around underneath you.
 *
 * Only simulations that have actually flown are offered. A row with no result is
 * not a choice, it is a run waiting to happen.
 */
export function ResultPicker({ fallbackName }: { fallbackName: string }) {
  const { t } = useTranslation();
  const sims = useWorkspaceStore((s) => s.sims);
  const activeId = useWorkspaceStore((s) => selectActive(s).id);
  const chosen = useWorkspaceStore((s) => s.resultSimId);
  const lastRunIds = useWorkspaceStore((s) => s.lastRunIds);
  const setChosen = useWorkspaceStore((s) => s.setResultSimId);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  // The simulations the LAST run flew, which is what there is to choose between.
  const ran = lastRunIds
    .map((id) => sims.find((x) => x.id === id))
    .filter((x): x is NonNullable<typeof x> => !!x?.result);
  // What the views are ACTUALLY showing, which is what the heading has to name:
  // the choice when it can be honored, else the active row (see `resultFlight`).
  const shownId = sims.some((s) => s.id === chosen && s.result) ? chosen : activeId;
  const name = sims.find((s) => s.id === shownId)?.name ?? fallbackName;

  // A single-simulation run is not a choice, so the heading is just a heading.
  if (ran.length < 2) return <h2 className="text-sm font-semibold text-slate-100">{name}</h2>;

  return (
    <div ref={wrap} className="relative inline-block">
      <h2>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          // The visible text is the flight being shown, which alone does not say
          // that the heading is also a control. The label carries both, the way
          // the table's row buttons do ("View results for Kept").
          aria-label={t('flight.pickAria', { name })}
          title={t('flight.pickTitle')}
          className="flex items-center gap-1 rounded-md px-1 py-0.5 text-sm font-semibold text-slate-100 hover:bg-slate-800"
        >
          {name}
          <span aria-hidden className="text-[9px] text-slate-400">
            ▼
          </span>
        </button>
      </h2>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-50 mt-1 min-w-48 rounded-lg bg-slate-900 p-1.5 shadow-xl ring-1 ring-white/15"
        >
          {ran.map((s) => {
            const on = s.id === shownId;
            return (
              <button
                key={s.id}
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  setChosen(s.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-800 ${
                  on ? 'text-sky-200' : 'text-slate-200'
                }`}
              >
                <span aria-hidden className="w-3 shrink-0 text-[10px]">
                  {on ? '✓' : ''}
                </span>
                <span className="flex-1 truncate">{s.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
