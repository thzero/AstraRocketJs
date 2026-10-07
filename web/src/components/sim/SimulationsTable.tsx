import { useTranslation } from 'react-i18next';
import type { Simulation, SimPrefs, SimStatus, SimRun } from '../../services/flight/simulations';
import { isOutdated, simStatus } from '../../services/flight/simulations';
import type { RocketTree } from '../../engine/openRocketEngine';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { fmtNum } from '../../i18n/format';
import { warningText } from '../../services/app/warningText';
import { loadoutLabel, type FlightConfig } from '../../services/flight/flightConfigs';
import { configOf } from '../../state/store';
import { launcherKind, withLauncher } from '../../services/design/launcher';

/** Dot color per status. Paired with a text label in the cell, never color alone. */
const TONE: Record<SimStatus, string> = {
  upToDate: 'bg-ok-400',
  outdated: 'bg-warn-400',
  // Queued is the same hue as running but still: with a pool, a batch shows a
  // few rows in the air and the rest waiting, and a waiting row that pulses
  // claims to be doing work it is not.
  queued: 'bg-accent-400/50',
  running: 'bg-accent-400 animate-pulse',
  failed: 'bg-danger-500',
  notRun: 'bg-prominent',
  // Figures from a file, not flown here: present, but not this app's run.
  fromFile: 'bg-ink-soft',
};

/**
 * The simulations table: one row per flight setup over the shared design, with
 * the columns OpenRocket's own simulation tab carries.
 *
 * The tab gives room for the table and the editor beside it, so comparing two
 * motors is reading two rows rather than switching back and forth.
 *
 * Narrow screens keep the three columns worth having (status, name, apogee) and
 * drop the rest; the table does not scroll sideways, because a phone dragging a
 * ten-column grid is not reading it either.
 */
export function SimulationsTable({
  sims,
  activeId,
  selectedIds,
  runs,
  tree,
  configs,
  simPrefs,
  onSetConfig,
  onSelect,
  onToggle,
  onToggleAll,
  onOpenResults,
}: {
  sims: Simulation[];
  activeId: string;
  /** Rows ticked for running. Empty means "just the active one" - see selectRunIds. */
  selectedIds: string[];
  /** Live run state per sim id: queued, running, or failed. Several rows can be
   *  running at once, since the worker pool flies them in parallel. */
  runs: Record<string, SimRun>;
  /** The design on screen. A `failed` entry only counts against the design it
   *  was recorded on; an edit since then means the run was never retried, not
   *  that it fails. */
  tree: RocketTree;
  /** The design's flight configurations, so each row can say what it flies. */
  configs: FlightConfig[];
  /** The global run preferences, which a row's result is compared against. */
  simPrefs: SimPrefs;
  /** Point one row at another configuration. */
  onSetConfig: (simId: string, configId: string) => void;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onToggleAll: (all: boolean) => void;
  /** Open this simulation's flight on the Results tab. Only rows that have one. */
  onOpenResults: (id: string) => void;
}) {
  const { t: plainT } = useTranslation();
  const t = withLauncher(
    plainT as unknown as (key: string, options?: Record<string, unknown>) => string,
    launcherKind(tree),
  );
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
    queued: t('sims.statusQueued'),
    running: t('sims.statusRunning'),
    failed: t('sims.statusFailed'),
    notRun: t('sims.notRun'),
    fromFile: t('sims.statusFromFile'),
  };

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-line/10 text-[11px] uppercase tracking-wide text-ink-muted">
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
              className="accent-accent-500"
            />
          </th>
          <Th>{t('sims.status')}</Th>
          <Th>{t('sims.name')}</Th>
          <Th wide>{t('configs.name')}</Th>
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
          const status = simStatus(s, runs, tree, isOutdated(s, tree, configOf(configs, s), simPrefs));
          const isActive = s.id === activeId;
          // A file's summary fills the row until the simulation is flown here.
          const r = s.result?.summary ?? s.fileSummary?.summary;
          // Every number is from the LAST run, which for an outdated row
          // describes a design that has since moved on. The row is dimmed to say
          // so — the numbers are still worth reading, they are just not current.
          const dim = status === 'outdated' || status === 'fromFile' ? 'text-ink-muted' : 'text-ink';
          return (
            // The row click is a mouse convenience; the button in the name cell
            // is what actually selects, so the table stays reachable from the
            // keyboard. (`aria-selected` would need a grid role on the table to
            // mean anything, so the button carries `aria-current` instead.)
            <tr
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`cursor-pointer border-b border-line/5 ${
                isActive ? 'bg-accent-600/20 ring-1 ring-inset ring-accent-500/40' : 'hover:bg-raised/60'
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
                  className="accent-accent-500"
                />
              </td>
              <Td>
                <span className="flex items-center gap-1.5">
                  <span className={`size-2 shrink-0 rounded-full ${TONE[status]}`} aria-hidden />
                  <span className="text-[11px] text-ink-muted">{statusLabel[status]}</span>
                  {/* A run can be current AND have flagged something, which the
                      status dot on its own cannot say. The detail is on the
                      Results tab; this is the pointer to it. */}
                  {!!s.result?.warnings?.length && (
                    <span
                      title={s.result.warnings.map((w) => warningText(w.message, t)).join('\n')}
                      className="shrink-0 text-[11px] text-warn-400"
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
                  className={`rounded text-left font-medium focus:outline-none focus:ring-1 focus:ring-accent-500 ${
                    isActive ? 'text-accent-100' : 'text-ink-strong'
                  }`}
                >
                  {s.name}
                </button>
              </Td>
              <Td wide>
                {/* A picker, not a readout: which setup a row flies is the one
                    thing about a row you change from the table, and crossing to
                    another tab to do it would make comparing two motors a
                    navigation exercise. `stopPropagation` because the row's own
                    click selects the simulation. */}
                <select
                  value={configOf(configs, s).id}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    onSetConfig(s.id, e.target.value);
                  }}
                  aria-label={t('configs.pickFor', { name: s.name })}
                  className="w-full max-w-56 rounded-md bg-raised px-1.5 py-1 text-xs text-ink ring-1 ring-line/10 focus:outline-none focus:ring-accent-500"
                >
                  {configs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || loadoutLabel(tree, c) || t('configs.noMotors')}
                    </option>
                  ))}
                </select>
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
                    className="rounded-md px-1.5 py-0.5 text-sm text-accent-300 hover:bg-elevated focus:outline-none focus:ring-1 focus:ring-accent-500"
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
      {children ?? <span className="text-ink-dim">–</span>}
    </td>
  );
}

function Unit({ children }: { children: React.ReactNode }) {
  return <span className="font-normal text-ink-faint">{children}</span>;
}
