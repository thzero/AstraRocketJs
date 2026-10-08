import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NumberInput } from '../common/NumberInput';
import { useUnits } from '../../prefs/useUnits';
import { onSi } from '../../prefs/entryValue';
import { unitScope } from '../../prefs/units';
import { useSettings } from '../../state/SettingsProvider';
import { useWorkspaceStore, configOf, selectDriftSweepFor } from '../../state/store';
import { sameSimInputs, simInputs } from '../../services/flight/simulations';
import { MAX_WIND_SPEED_MS } from '../../services/flight/safetyLimits';
import {
  defaultSweepSpec,
  normalizeSweepSpec,
  sweepFlightCount,
  surfaceWind,
  type WindSweepSpec,
} from '../../services/flight/windSweep';
import type { LaunchConditions } from '../../services/design/orkTree';

/**
 * The controls for a wind sweep: the grid to fly, and what came of the last one.
 *
 * It lives ON the ground track rather than in the simulations table because a
 * sweep is not a simulation — it produces no row, no apogee and no flight card,
 * only a region on the one view that can draw it. Asking for it where the
 * answer appears is also what keeps the thirty-two flights it costs legible:
 * the button is next to the picture it changes.
 *
 * The spec is component state, seeded from the flight's own wind. It is not
 * persisted and not undoable: it is a question being asked, not part of the
 * design or of the simulation, and the answer (the sweep) is what the store
 * holds.
 */

/** The arcs offered for the heading fan, degrees. */
const SPANS = [360, 180, 90, 45] as const;

const btn =
  'rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-line/10 disabled:opacity-40 disabled:cursor-not-allowed';

const numCls =
  'w-16 rounded bg-raised px-1 py-0.5 text-right text-[11px] tabular-nums text-ink-strong ring-1 ring-line/10';

export function DriftSweepPanel({ simId, launch }: { simId: string; launch: LaunchConditions }) {
  const { t } = useTranslation();
  const u = useUnits();
  const { settings } = useSettings();
  const wind = u.at(unitScope('launch', 'speed'), 'windspeed');

  const mine = useWorkspaceStore((s) => selectDriftSweepFor(s, simId));
  const run = useWorkspaceStore((s) => s.driftSweepRun);
  const tree = useWorkspaceStore((s) => s.tree);
  const sim = useWorkspaceStore((s) => s.sims.find((x) => x.id === simId));
  const configs = useWorkspaceStore((s) => s.configs);
  const runDriftSweep = useWorkspaceStore((s) => s.runDriftSweep);
  const cancelDriftSweep = useWorkspaceStore((s) => s.cancelDriftSweep);
  const clearDriftSweep = useWorkspaceStore((s) => s.clearDriftSweep);

  // Seeded from the flight's OWN surface wind, so opening the panel proposes a
  // band around the day that was typed rather than a constant somebody has to
  // retype every time.
  const [spec, setSpec] = useState<WindSweepSpec>(() => defaultSweepSpec(surfaceWind(launch).speedMs));
  const flights = useMemo(() => sweepFlightCount(spec), [spec]);

  const busy = run !== null;
  // Either half can age it: the airframe, or the row's own motor, loadout and
  // launch conditions. A sweep for a row that has since been deleted is stale
  // too, since there is nothing left to compare it against.
  const stale =
    mine !== null &&
    (mine.tree !== tree || !sim || !sameSimInputs(mine.inputs, simInputs(sim, configOf(configs, sim))));

  const patch = (p: Partial<WindSweepSpec>) => setSpec((cur) => ({ ...cur, ...p }));
  /** Blur or a discrete change: the field stops mid-edit and is pulled into range. */
  const settle = () => setSpec((cur) => normalizeSweepSpec(cur));

  /** The two ends of the speed band: the same field twice, in the user's unit. */
  const speedRow = (key: 'speedMinMs' | 'speedMaxMs', label: string) => (
    <label key={key} className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-ink-muted">{label}</span>
      <span className="flex items-center gap-1">
        <NumberInput
          value={wind.toUi(spec[key])}
          onChange={onSi(wind, (si) => patch({ [key]: si ?? 0 }))}
          onCommit={settle}
          step={wind.step(0.5)}
          min={0}
          // The safety code's ceiling, so the band cannot be typed past the
          // wind this app refuses to fly in (`normalizeSweepSpec` enforces the
          // same bound on whatever gets through).
          max={wind.toUi(MAX_WIND_SPEED_MS)}
          disabled={busy}
          ariaLabel={label}
          className={numCls}
        />
        <span className="w-8 text-[10px] text-ink-faint">{wind.sym}</span>
      </span>
    </label>
  );

  /** A grid count: a whole number of at least one, up to `max`. */
  const stepsRow = (key: 'speedSteps' | 'headingSteps', label: string, max: number) => (
    <label className="flex items-center justify-between gap-2 text-[11px]">
      <span className="text-ink-muted">{label}</span>
      <NumberInput
        value={spec[key]}
        onChange={(v) => patch({ [key]: v ?? 1 })}
        onCommit={settle}
        step={1}
        min={1}
        max={max}
        disabled={busy}
        ariaLabel={label}
        className={numCls}
      />
    </label>
  );

  return (
    // `min-h-0` + scroll: the panel lives inside the square plot, which on a
    // phone is barely taller than the panel itself, and the box clips its
    // overflow — without this the Run button is the part that goes missing.
    <div className="min-h-0 w-60 overflow-y-auto rounded-lg bg-surface/95 p-2.5 text-ink-soft ring-1 ring-line/10">
      {/* Said here rather than only in the docs: this is the panel somebody is
          looking at when they decide how big a field they need, and the region
          it draws has not been checked against a real recovery. The individual
          flights are the same validated kernel as any other simulation; what is
          unsettled is the shape drawn round them, the default grid and the
          two-sigma choice. */}
      <div className="mb-2 flex items-baseline gap-1.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{t('sweep.title')}</h3>
        <span className="rounded bg-warn-400/15 px-1 text-[9px] font-medium uppercase tracking-wide text-warn-300 ring-1 ring-warn-400/30">
          {t('sweep.experimental')}
        </span>
      </div>
      <p className="mb-2 text-[10px] leading-snug text-ink-faint">{t('sweep.experimentalNote')}</p>

      <div className="space-y-1.5">
        {speedRow('speedMinMs', t('sweep.speedFrom'))}
        {speedRow('speedMaxMs', t('sweep.speedTo'))}
        {stepsRow('speedSteps', t('sweep.speedSteps'), 12)}
        {stepsRow('headingSteps', t('sweep.headingSteps'), 36)}
        <label className="flex items-center justify-between gap-2 text-[11px]">
          <span className="text-ink-muted">{t('sweep.headingSpan')}</span>
          <select
            value={spec.headingSpanDeg}
            onChange={(e) => setSpec((cur) => normalizeSweepSpec({ ...cur, headingSpanDeg: Number(e.target.value) }))}
            disabled={busy}
            aria-label={t('sweep.headingSpan')}
            className="w-[76px] rounded bg-raised px-1 py-0.5 text-right text-[11px] tabular-nums text-ink-strong ring-1 ring-line/10"
          >
            {SPANS.map((d) => (
              <option key={d} value={d}>
                {d === 360 ? t('sweep.spanAll') : `±${d / 2}°`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* The bill, before it is run. Thirty-two flights is a real wait, and the
          two step fields multiply — which is not obvious from two boxes. */}
      <p className="mt-2 text-[10px] text-ink-faint">{t('sweep.flights', { count: flights })}</p>

      <div className="mt-2 flex items-center gap-1.5">
        {busy ? (
          <>
            <button onClick={cancelDriftSweep} className={`${btn} bg-raised text-ink hover:bg-elevated`}>
              {t('common.cancel')}
            </button>
            <span className="text-[10px] tabular-nums text-ink-muted">
              {t('sweep.progress', { done: run.done, total: run.total })}
            </span>
          </>
        ) : (
          <>
            <button
              onClick={() => void runDriftSweep(simId, spec, settings.simulation)}
              className={`${btn} bg-accent-600 text-on-accent hover:bg-accent-500`}
            >
              {t('sweep.run')}
            </button>
            {mine && (
              <button onClick={clearDriftSweep} className={`${btn} bg-raised text-ink-soft hover:bg-elevated`}>
                {t('sweep.clear')}
              </button>
            )}
          </>
        )}
      </div>

      {mine && !busy && (
        <p className="mt-2 text-[10px] leading-snug text-ink-muted">
          {t('sweep.landed', { flown: mine.flown, asked: mine.asked })}
        </p>
      )}
      {/* The design moved after the sweep flew. The region is still the honest
          answer for the rocket that flew it, so it stays on screen and says so
          rather than vanishing under the user. */}
      {stale && <p className="mt-1 text-[10px] leading-snug text-warn-400">{t('sweep.stale')}</p>}
    </div>
  );
}
