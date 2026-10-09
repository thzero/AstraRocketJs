import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive } from '../../state/store';
import { resultFlight } from '../../services/flight/simulations';
import { useMenuPopover } from '../common/useMenuPopover';

/**
 * Which flight the Results tab is reading, and the pane's heading.
 *
 * It is the heading rather than sitting beside one: a title naming the flight
 * and a dropdown showing the same name next to it would say one thing twice.
 *
 * One run, one name. The choice is offered only when the last run flew more than
 * one simulation, and then it lists exactly those. Counting simulations that have
 * a result is a different thing: results persist, so running one simulation after
 * having run another last week would put a dropdown on screen for a single run. An
 * `h2` either way, so the pane keeps a landmark a screen reader can jump to.
 *
 * A picker of its own, not the Simulations table's tick boxes. The ticks answer
 * "which rows should Run fly"; this answers "which flight am I reading". Sharing
 * one control for both means reading a result silently re-arms the Run button, and
 * ticking rows to fly them yanks the charts around underneath you.
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
  const { open, toggle, close, wrapRef, triggerRef } = useMenuPopover();

  // The simulations the last run flew, which is what there is to choose between.
  const ran = lastRunIds
    .map((id) => sims.find((x) => x.id === id))
    .filter((x): x is NonNullable<typeof x> => !!x?.result);
  // What the views are actually showing, which is what the heading has to name:
  // the choice when it can be honored, else the active row.
  const shown = resultFlight(sims, chosen, activeId);
  const name = shown?.name ?? sims.find((s) => s.id === activeId)?.name ?? fallbackName;

  // A single-simulation run is not a choice, so the heading is just a heading.
  if (ran.length < 2) return <h2 className="text-sm font-semibold text-ink-strong">{name}</h2>;

  return (
    <div ref={wrapRef} className="relative inline-block">
      <h2>
        <button
          ref={triggerRef}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          // The visible text is the flight being shown, which alone does not say
          // that the heading is also a control. The label carries both, the way
          // the table's row buttons do ("View results for Kept").
          aria-label={t('flight.pickAria', { name })}
          title={t('flight.pickTitle')}
          className="flex items-center gap-1 rounded-md px-1 py-0.5 text-sm font-semibold text-ink-strong hover:bg-raised"
        >
          {name}
          <span aria-hidden className="text-[9px] text-ink-muted">
            ▼
          </span>
        </button>
      </h2>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-50 mt-1 min-w-48 rounded-lg bg-surface p-1.5 shadow-xl ring-1 ring-line/15"
        >
          {ran.map((s) => {
            const on = s.id === shown?.id;
            return (
              <button
                key={s.id}
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  setChosen(s.id);
                  close();
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-raised ${
                  on ? 'text-accent-200' : 'text-ink'
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
