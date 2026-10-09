import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectConfig, selectDesignName } from '../../state/store';
import { primaryMotor } from '../../services/flight/flightConfigs';
import { fmtNum } from '../../i18n/format';
import { useUnits } from '../../prefs/useUnits';
import { aeroTableCsv, CSV_MIME } from '../../services/exports/csvExport';
import { exportFilename } from '../../services/files/saveFile';
import { download } from '../../services/files/saveFile';
import type { ComponentMass } from '../../engine/openRocketEngine';
import type { ChartSeries, CpMode } from './aeroTables';
import { cpDivisor, cpModesFor } from './aeroTables';
import { useAeroSweep } from './useAeroSweep';
import { ChartCard } from './AeroCharts';
import { ComponentTable, RollTable, StabilityTable } from './AeroComponentTables';
import { Num } from './AeroInputs';
import { Segmented } from '../common/Segmented';
import { CATEGORICAL } from '../common/chartPalette';

// The pure helpers live in aeroTables.ts (where they are tested); re-exported
// here for importers that reach them through this module.
export { buildLinePath, heat, hsv, niceName } from './aeroTables';

/**
 * Aerodynamic analysis (RASAero-style "Aero Plots"). Two panes
 * off the static design, no flight needed: it is all one `aeroSweep`.
 *
 * **Charts**: Cd vs Mach (power-off, + power-on when a nozzle exit is set), the
 * drag breakdown into friction/pressure/base, and CP vs Mach (length unit, %
 * of the airframe, or % of the aerodynamic length). A shared hover crosshair
 * and legend readout tie all three to one Mach.
 *
 * **Per component**: that same Mach, tabulated per part (drag, stability
 * contribution (CN-alpha, CP, mass) and roll dynamics), the three tabs of the
 * desktop's Component Analysis dialog.
 *
 * This file is the pane: the header controls, the shared Mach state and the
 * series the charts draw. The sweep itself is `useAeroSweep`, the chart cards
 * are `AeroCharts`, the tables are `AeroComponentTables`, and the number
 * boxes and segmented toggles are `AeroInputs`.
 *
 * Colors use the dataviz skill's validated dark categorical order; every chart
 * ≥ 2 series carries a legend (identity is never color-alone).
 */
const POWER_OFF = CATEGORICAL[0]!;
const POWER_ON = CATEGORICAL[7]!;

type Series = ChartSeries;

export function AeroAnalysis() {
  const { t } = useTranslation();
  const u = useUnits();
  const rocket = useWorkspaceStore((s) => s.rocket);
  const designName = useWorkspaceStore(selectDesignName);
  const info = useWorkspaceStore((s) => s.info);
  // Which motor the power-on curve belongs to.
  //
  // Everything else here is geometry -- power-off Cd, the friction/pressure/base
  // split, CP, CNa, the roll coefficients -- and does not depend on the motor at
  // all. The one exception is the power-on curve, which the kernel builds from
  // the stage's nozzle exit diameter applied to the seated motor's config
  // (OpenRocketEngine.applyMotor). The panel has no motor selector of its own
  // -- it analyzes whatever the active simulation has loaded, which is our
  // equivalent of the desktop dialog's motor-configuration dropdown -- so when
  // that curve is on screen, say whose it is.
  const motorName = useWorkspaceStore((s) => primaryMotor(s.tree, selectConfig(s))?.designation);
  // M1 by default: most hobby flights never reach Mach 1, and a wider sweep
  // spends most of the x axis on speeds the rocket will not see, squeezing the
  // subsonic rise into a sliver.
  const [machMax, setMachMax] = useState(1);
  // How the CP axis reads: the user's length unit, a percentage of the whole
  // airframe, or a percentage of the AERODYNAMIC length. The last is the
  // denominator OpenRocket's own PercentageOfLengthUnit uses
  // (`getLengthAerodynamic`), so it is the one that matches the desktop; the
  // middle one answers "where on the rocket in front of me", which is a
  // different and equally wanted question. Both are offered rather than one
  // being chosen for the user.
  const [cpModeSel, setCpMode] = useState<CpMode>('len');
  const [hoverM, setHoverM] = useState<number | null>(null);
  const [pane, setPane] = useState<'charts' | 'components'>('charts');
  // The Mach the tables report at. Hovering a chart parks it there too, so
  // switching to the tables lands on the point you were just looking at rather
  // than resetting -- the crosshair and the slider drive the same value.
  const [machPick, setMachPick] = useState(0.3);
  // The flight conditions the whole sweep is flown at. All four default to
  // zero: no angle of attack, wind from 0°, no roll, sea level.
  const [aoaDeg, setAoaDeg] = useState(0);
  const [thetaDeg, setThetaDeg] = useState(0);
  const [rollRate, setRollRate] = useState(0);
  const [altitudeM, setAltitudeM] = useState(0);

  // Deferred off the render (see useAeroSweep): the previous sweep stays up
  // while the next one runs, and `pending` says so in the header.
  const { sweep, pending } = useAeroSweep(rocket, { machMax, aoaDeg, thetaDeg, rollRate, altitudeM });

  // The picked Mach, clamped to the sweep at read time. Shrinking the sweep has
  // to bring the picked Mach back with it, or the strip header prints the raw
  // pick while the tables snap to the nearest sample that exists: set Max Mach
  // to 5, scrub to 3.0, switch back to M1, and the header reads "at Mach 3.00"
  // above three tables reading Mach 1.00. Derived rather than clamped in an
  // effect, which costs a render at the wrong value before the correction.
  const pick = Math.min(machPick, machMax);
  // The slider sticks at the last hovered Mach once the pointer leaves. The
  // commit happens in the setter, on the transition to null, not in an effect
  // watching `hoverM`, which would run after every hover render and need a
  // ref just to notice the leave. All hover writes go through this
  // one function, so its ref is the true previous value for the functional
  // form. `setHoverM` itself is never handed out.
  const lastHover = useRef<number | null>(null);
  const setHover = useCallback((m: number | null | ((prev: number | null) => number | null)) => {
    const next = typeof m === 'function' ? m(lastHover.current) : m;
    if (next == null && lastHover.current != null) setMachPick(lastHover.current);
    lastHover.current = next;
    setHoverM(next);
  }, []);
  // The crosshair wins while it exists; the slider is the resting value.
  const tableMach = hoverM ?? pick;

  // Mass does not vary with Mach, so this is keyed on the rocket alone rather
  // than recomputed with every sweep.
  const masses = useMemo<ComponentMass[]>(() => {
    if (!rocket) return [];
    try {
      return rocket.componentMasses();
    } catch (e) {
      console.error('componentMasses failed', e);
      return [];
    }
  }, [rocket]);

  // Memoized so each ChartCard sees the same series identity across hover
  // renders: the cards memoize their domain and paths on the series, so a fresh
  // array per render defeats that on every pointer move. `cpSeries` maps the
  // whole sweep.
  const lengthFactor = u.factor('length');
  const bodyLen = info?.length ?? 0;
  // The engine's own aerodynamic span, not a length this module derives: it
  // bounds only the components with an aerodynamic effect, so it is shorter
  // than `length` on any design with an overhanging rail button or shock cord.
  const aeroLen = info?.lengthAerodynamic ?? 0;
  const cpModes = useMemo(() => cpModesFor(bodyLen, aeroLen), [bodyLen, aeroLen]);
  // A selection the current design cannot express falls back rather than
  // sticking: switching to a design with no aerodynamic length must not leave
  // the axis claiming a percentage it is no longer drawing.
  const cpMode = cpModes.includes(cpModeSel) ? cpModeSel : 'len';
  const cpDiv = cpDivisor(cpMode, bodyLen, aeroLen);
  const { cdSeries, breakdown, cpSeries } = useMemo((): {
    cdSeries: Series[];
    breakdown: Series[];
    cpSeries: Series[];
  } => {
    if (!sweep) return { cdSeries: [], breakdown: [], cpSeries: [] };
    const cd: Series[] = [{ name: t('aero.powerOff'), color: POWER_OFF, values: sweep.powerOff.total }];
    if (sweep.hasNozzle) cd.push({ name: t('aero.powerOn'), color: POWER_ON, values: sweep.powerOn.total });
    return {
      cdSeries: cd,
      // By type only. The Per component pane tabulates the same figures with the
      // pressure / base / friction split beside them, which a stack of lines,
      // one per part, cannot show.
      breakdown: [
        { name: t('aero.friction'), color: CATEGORICAL[0]!, values: sweep.powerOff.friction },
        { name: t('aero.pressure'), color: CATEGORICAL[1]!, values: sweep.powerOff.pressure },
        { name: t('aero.base'), color: CATEGORICAL[2]!, values: sweep.powerOff.base },
      ],
      // As a percentage CP has no unit; as a position it takes the user's
      // length unit (a whole series is being scaled).
      cpSeries: [
        {
          name: t('flight.cp'),
          color: POWER_OFF,
          values: cpDiv > 0 ? sweep.cp.map((v) => (v / cpDiv) * 100) : sweep.cp.map((v) => v * lengthFactor),
        },
      ],
    };
  }, [sweep, cpDiv, lengthFactor, t]);

  if (!sweep)
    return (
      <div className="grid h-full place-items-center text-sm text-ink-faint" aria-busy={pending}>
        {pending ? t('aero.computing') : t('aero.unavailable')}
      </div>
    );

  const machs = sweep.machs;
  const machMin = machs[0] ?? 0.05;

  return (
    <div className="flex h-full flex-col rounded-xl bg-surface ring-1 ring-line/10" aria-busy={pending}>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2 pt-3">
        <h2 className="mr-auto text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {t('aero.title')}
          {/* The previous sweep stays up while the next one runs; say so. */}
          {pending && <span className="ml-2 normal-case tracking-normal text-ink-faint">{t('aero.computing')}</span>}
        </h2>
        <Segmented
          options={['charts', 'components'] as const}
          value={pane}
          onChange={setPane}
          fmt={(v) => t(v === 'charts' ? 'aero.charts' : 'aero.perComponent')}
        />
        {sweep?.hasNozzle && motorName && (
          <span className="text-[10px] text-ink-faint" title={t('aero.powerOnMotorNote')}>
            {t('aero.powerOnMotor', { motor: motorName })}
          </span>
        )}
        <span className="text-[10px] text-ink-faint">{t('aero.maxMach')}</span>
        <Segmented options={[1, 2, 3, 5] as const} value={machMax} onChange={setMachMax} fmt={(v) => `M${v}`} />
        <button
          onClick={() =>
            download(exportFilename([designName, 'aero-table'], 'csv'), aeroTableCsv(sweep, u.all), CSV_MIME)
          }
          title={t('aero.exportCsv')}
          className="rounded-md bg-raised px-2 py-1 text-[11px] font-medium text-ink ring-1 ring-line/10 hover:bg-elevated"
        >
          ⬇ CSV
        </button>
      </div>
      {/* The conditions the sweep is flown at. Changing one re-runs it, the
          same way Max Mach does. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-2">
        <Num label={t('aero.aoa')} value={aoaDeg} onChange={setAoaDeg} min={0} max={20} step={0.5} unit="°" />
        <div className="flex items-center gap-1.5">
          <Num
            label={t('aero.windDirection')}
            value={thetaDeg}
            onChange={setThetaDeg}
            min={0}
            max={360}
            step={5}
            unit="°"
          />
          <button
            // Wrapped like its neighbors (the sweep and componentMasses): a
            // kernel that throws here (a build without the method, or a
            // degenerate design) would otherwise throw out of a React event
            // handler and take the whole pane down rather than leaving the
            // field alone.
            onClick={() => {
              if (!rocket) return;
              try {
                setThetaDeg(Math.round(rocket.worstThetaDeg(pick, aoaDeg) * 10) / 10);
              } catch (e) {
                // Leave the wind direction as it is, but say why.
                console.error('worstThetaDeg failed', e);
              }
            }}
            title={t('aero.worstNote')}
            className="rounded-md bg-raised px-2 py-0.5 text-[11px] font-medium text-ink ring-1 ring-line/10 hover:bg-elevated"
          >
            {t('aero.worst')}
          </button>
        </div>
        <Num
          label={t('aero.rollRate')}
          value={rollRate}
          onChange={setRollRate}
          min={0}
          max={50}
          step={1}
          unit="rad/s"
        />
        {/* Shown in the altitude unit; the sweep takes meters. Up to 30 km,
            where the standard atmosphere still has air worth sweeping. */}
        <Num
          label={t('aero.altitude')}
          value={Math.round(altitudeM * u.factor('distance'))}
          onChange={(v) => setAltitudeM(v / u.factor('distance'))}
          min={0}
          max={Math.round(30_000 * u.factor('distance'))}
          step={Math.round(500 * u.factor('distance'))}
          unit={u.sym('distance')}
        />
      </div>

      {/* The Mach both panes report at. Shown on the Charts pane too, so a
          figure at a given Mach can be reached from the keyboard and not only
          by hovering; the crosshair drives the same state when a pointer is
          used. */}
      <div className="flex items-center gap-2 px-3 pb-2">
        <span className="shrink-0 text-[10px] text-ink-faint">{t('aero.atMach', { mach: fmtNum(pick, 2) })}</span>
        <input
          type="range"
          min={machs[0] ?? 0}
          max={machs[machs.length - 1] ?? 1}
          // Step by the sweep's own sampling, so the slider can only land on a
          // Mach that was actually computed; otherwise it reads 0.30 while
          // the tables, which snap to the nearest sample, read 0.29.
          step={(machs[1] ?? 0.05) - (machs[0] ?? 0)}
          value={pick}
          onChange={(e) => setMachPick(parseFloat(e.target.value))}
          aria-label={t('aero.machPicker')}
          className="w-full accent-accent-500"
        />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {pane === 'charts' && (
          <>
            <ChartCard
              title={t('aero.cdVsMach')}
              machs={machs}
              machMin={machMin}
              machMax={machMax}
              series={cdSeries}
              unit="Cd"
              digits={3}
              hoverM={hoverM}
              setHoverM={setHover}
            />
            <ChartCard
              title={t('aero.breakdown')}
              machs={machs}
              machMin={machMin}
              machMax={machMax}
              series={breakdown}
              stacked
              unit="Cd"
              digits={3}
              hoverM={hoverM}
              setHoverM={setHover}
            />
            <ChartCard
              title={t('aero.cpVsMach')}
              machs={machs}
              machMin={machMin}
              machMax={machMax}
              series={cpSeries}
              unit={cpMode === 'len' ? u.sym('length') : '%'}
              digits={1}
              hoverM={hoverM}
              setHoverM={setHover}
              note={t('aero.supersonicNote')}
              right={
                <Segmented
                  options={cpModes}
                  value={cpMode}
                  onChange={setCpMode}
                  fmt={(v) => (v === 'len' ? u.sym('length') : v === 'body' ? t('aero.pctBody') : t('aero.pctLength'))}
                  disabled={cpModes.length < 2}
                />
              }
            />
          </>
        )}
        {pane === 'components' && (
          <>
            <ComponentTable sweep={sweep} machs={machs} mach={tableMach} />
            <StabilityTable
              sweep={sweep}
              machs={machs}
              masses={masses}
              mach={tableMach}
              lengthUnit={u.sym('length')}
              lengthFactor={u.factor('length')}
              massUnit={u.sym('mass')}
              massFactor={u.factor('mass')}
              bodyLen={bodyLen}
              aeroLen={aeroLen}
            />
            <RollTable sweep={sweep} machs={machs} mach={tableMach} />
          </>
        )}
      </div>
    </div>
  );
}
