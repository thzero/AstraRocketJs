import { useTranslation } from 'react-i18next';
import type { Simulation, SimStatus } from '../../services/simulations';
import { simStatus } from '../../services/simulations';
import type { MotorSpec } from '../../engine/openRocketEngine';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { fmtNum } from '../../i18n/format';
import { warningText } from '../../services/warningText';

/** "Estes C6" — manufacturer + designation, or just the designation if unknown. */
function motorLabel(m: MotorSpec): string {
  return m.manufacturer ? `${m.manufacturer} ${m.designation}` : m.designation;
}

/** Dot color per status. Paired with a text label in the cell, never color alone. */
const TONE: Record<SimStatus, string> = {
  upToDate: 'bg-emerald-400',
  outdated: 'bg-amber-400',
  running: 'bg-sky-400 animate-pulse',
  failed: 'bg-red-500',
  notRun: 'bg-slate-600',
};

/**
 * The simulations table: one row per flight setup over the shared design, with
 * the columns OpenRocket's own simulation tab carries.
 *
 * It replaces an accordion that could show the LIST or the selected simulation's
 * configuration but never both — a workaround for the 380px column the sim panel
 * used to live in. With its own tab there is room for the table and the editor
 * beside it, so comparing two motors is reading two rows rather than switching
 * back and forth.
 *
 * Narrow screens keep the three columns worth having (status, name, apogee) and
 * drop the rest; the table does not scroll sideways, because a phone dragging a
 * ten-column grid is not reading it either.
 */
export function SimulationsTable({
  sims,
  activeId,
  selectedIds,
  runningId,
  failedId,
  onSelect,
  onToggle,
  onToggleAll,
  onOpenResults,
}: {
  sims: Simulation[];
  activeId: string;
  /** Rows ticked for running. Empty means "just the active one" - see selectRunIds. */
  selectedIds: string[];
  /** The sim currently in flight, if any. */
  runningId: string | null;
  /** The sim whose last run threw on the design that is still loaded. */
  failedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onToggleAll: (all: boolean) => void;
  /** Open this simulation's flight on the Results tab. Only rows that have one. */
  onOpenResults: (id: string) => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  // Each column owns its unit, and shares the scope with the summary tiles — so
  // reading apogee in feet there reads in feet here too.
  const apogee = u.at(unitScope('sim', 'apogee'), 'distance');
  const rodExit = u.at(unitScope('sim', 'rodExit'), 'velocity');
  const maxSpeed = u.at(unitScope('sim', 'maxSpeed'), 'velocity');
  const maxAccel = u.at(unitScope('sim', 'maxAccel'), 'acceleration');
  const landing = u.at(unitScope('sim', 'landing'), 'velocity');

  // Ticking is a separate question from selecting: the tick says "fly this",
  // the name says "edit this". Header box ticks or clears every row.
  const allTicked = sims.length > 0 && selectedIds.length === sims.length;
  const someTicked = selectedIds.length > 0 && !allTicked;

  const statusLabel: Record<SimStatus, string> = {
    upToDate: t('sims.statusUpToDate'),
    outdated: t('sims.statusOutdated'),
    running: t('sims.statusRunning'),
    failed: t('sims.statusFailed'),
    notRun: t('sims.notRun'),
  };

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-slate-400">
          <th scope="col" className="w-8 px-2 py-2">
            <input
              type="checkbox"
              checked={allTicked}
              ref={(el) => {
                // Some but not all: the box is neither on nor off, and saying so
                // is the only way the header reflects a partial selection.
                if (el) el.indeterminate = someTicked;
              }}
              onChange={(e) => onToggleAll(e.target.checked)}
              aria-label={t('sims.selectAll')}
              className="accent-sky-500"
            />
          </th>
          <Th>{t('sims.status')}</Th>
          <Th>{t('sims.name')}</Th>
          <Th wide>{t('sims.motor')}</Th>
          <Th num>
            {t('sim.apogee')} <Unit>{apogee.sym}</Unit>
          </Th>
          <Th num wide>
            {t('sim.maxSpeed')} <Unit>{maxSpeed.sym}</Unit>
          </Th>
          <Th num wide>
            {t('sim.maxAccel')} <Unit>{maxAccel.sym}</Unit>
          </Th>
          <Th num wide>
            {t('sim.rodExit')} <Unit>{rodExit.sym}</Unit>
          </Th>
          <Th num wide>
            {t('sim.toApogee')} <Unit>s</Unit>
          </Th>
          <Th num wide>
            {t('sim.flightTime')} <Unit>s</Unit>
          </Th>
          <Th num wide>
            {t('sim.landing')} <Unit>{landing.sym}</Unit>
          </Th>
          <th scope="col" className="w-10 px-2 py-2" />
        </tr>
      </thead>
      <tbody>
        {sims.map((s) => {
          const status = simStatus(s, { runningId, failedId });
          const isActive = s.id === activeId;
          const r = s.result?.summary;
          // Every number is from the LAST run, which for an outdated row
          // describes a design that has since moved on. The row is dimmed to say
          // so — the numbers are still worth reading, they are just not current.
          const dim = status === 'outdated' ? 'text-slate-400' : 'text-slate-200';
          return (
            // The row click is a mouse convenience; the button in the name cell
            // is what actually selects, so the table stays reachable from the
            // keyboard. (`aria-selected` would need a grid role on the table to
            // mean anything, so the button carries `aria-current` instead.)
            <tr
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`cursor-pointer border-b border-white/5 ${
                isActive ? 'bg-sky-600/20 ring-1 ring-inset ring-sky-500/40' : 'hover:bg-slate-800/60'
              }`}
            >
              <td className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(s.id)}
                  // The row's own click selects it for EDITING; the tick must not
                  // also drag the editor over to a row you only wanted to fly.
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggle(s.id)}
                  aria-label={t('sims.selectOne', { name: s.name })}
                  className="accent-sky-500"
                />
              </td>
              <Td>
                <span className="flex items-center gap-1.5">
                  <span className={`size-2 shrink-0 rounded-full ${TONE[status]}`} aria-hidden />
                  <span className="text-[11px] text-slate-400">{statusLabel[status]}</span>
                  {/* A run can be current AND have flagged something, which the
                      status dot on its own cannot say. The detail is on the
                      Results tab; this is the pointer to it. */}
                  {!!s.result?.warnings?.length && (
                    <span
                      title={s.result.warnings.map((w) => warningText(w.message, t)).join('\n')}
                      className="shrink-0 text-[11px] text-amber-400"
                    >
                      &#9888; {s.result.warnings.length}
                    </span>
                  )}
                </span>
              </Td>
              <Td>
                <button
                  onClick={() => onSelect(s.id)}
                  aria-current={isActive ? 'true' : undefined}
                  className={`rounded text-left font-medium focus:outline-none focus:ring-1 focus:ring-sky-500 ${
                    isActive ? 'text-sky-100' : 'text-slate-100'
                  }`}
                >
                  {s.name}
                </button>
              </Td>
              <Td wide>
                <span className="text-slate-400">{motorLabel(s.motor)}</span>
              </Td>
              <Num className={dim}>{r ? apogee.fmt(r.maxAltitude) : null}</Num>
              <Num wide className={dim}>
                {r ? maxSpeed.fmt(r.maxVelocity) : null}
              </Num>
              <Num wide className={dim}>
                {r ? maxAccel.fmt(r.maxAcceleration) : null}
              </Num>
              <Num wide className={dim}>
                {r ? rodExit.fmt(r.launchRodVelocity) : null}
              </Num>
              <Num wide className={dim}>
                {r ? fmtNum(r.timeToApogee, 1) : null}
              </Num>
              <Num wide className={dim}>
                {r ? fmtNum(r.flightTime, 1) : null}
              </Num>
              <Num wide className={dim}>
                {r ? landing.fmt(r.groundHitVelocity) : null}
              </Num>
              <td className="w-10 px-2 py-2 text-right">
                {/* A run that has a result is worth looking at, and the Results
                    tab shows ONE simulation - so each row needs its own way in.
                    Without this a batch left every row flown and no route to any
                    of them but re-running one. */}
                {!!s.result && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation(); // the row click only selects; this navigates
                      onOpenResults(s.id);
                    }}
                    title={t('sims.viewResults')}
                    aria-label={t('sims.viewResultsFor', { name: s.name })}
                    className="rounded-md px-1.5 py-0.5 text-sm text-sky-300 hover:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    📊
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** `wide` columns are dropped below the desktop breakpoint — see the file docs. */
function Th({ children, num, wide }: { children: React.ReactNode; num?: boolean; wide?: boolean }) {
  return (
    <th
      scope="col"
      className={`${wide ? 'hidden lg:table-cell' : ''} px-2 py-2 font-semibold ${num ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

function Td({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <td className={`${wide ? 'hidden lg:table-cell' : ''} px-2 py-2`}>{children}</td>;
}

/** A measured cell: right-aligned and tabular, so the column reads as a column.
 *  An empty value renders an em dash rather than nothing, so a never-run row is
 *  visibly blank rather than looking like a rendering failure. */
function Num({ children, wide, className }: { children: React.ReactNode; wide?: boolean; className?: string }) {
  return (
    <td className={`${wide ? 'hidden lg:table-cell' : ''} px-2 py-2 text-right tabular-nums ${className ?? ''}`}>
      {children ?? <span className="text-slate-600">–</span>}
    </td>
  );
}

function Unit({ children }: { children: React.ReactNode }) {
  return <span className="font-normal text-slate-500">{children}</span>;
}
