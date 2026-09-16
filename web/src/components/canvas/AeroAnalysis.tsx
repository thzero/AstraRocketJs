import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore, selectActive } from '../../state/store';
import { useSettings } from '../../state/SettingsProvider';
import { fmtNum } from '../../i18n/format';
import { useUnits } from '../../prefs/useUnits';
import { aeroTableCsv, CSV_MIME } from '../../services/csvExport';
import { download } from '../../services/saveFile';
import { lerpAt } from '../../services/interpolate';
import type { ComponentMass, AeroSweep } from '../../engine/openRocketEngine';

/**
 * Aerodynamic analysis (RASAero-style "Aero Plots", mmrocket-style). Two panes
 * off the static design, no flight needed — it is all one `aeroSweep`.
 *
 * **Charts**: Cd vs Mach (power-off, + power-on when a nozzle exit is set), the
 * drag breakdown into friction/pressure/base, and CP vs Mach (cm or % body
 * length). A shared hover crosshair and legend readout tie all three to one Mach.
 *
 * **Per component**: that same Mach, tabulated per part — drag, stability
 * contribution (CN-alpha, CP, mass) and roll dynamics — the three tabs of the
 * desktop's Component Analysis dialog.
 *
 * Colors use the dataviz skill's validated dark categorical order; every chart
 * ≥ 2 series carries a legend (identity is never color-alone).
 */
const CAT = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];
const POWER_OFF = CAT[0]!;
const POWER_ON = CAT[7]!;

const PAD_L = 46,
  PAD_R = 14,
  PAD_T = 10,
  PAD_B = 20,
  CHART_H = 168;

interface Series {
  name: string;
  color: string;
  values: number[];
}

/** Engine aero-component keys arrive as "[Class.Instance]"; show the user's name
 *  when set, else the CamelCase class split into words (BodyTube → "Body Tube"). */
function niceName(raw: string): string {
  const m = raw.match(/^\[?([^.\]]+)\.([^.\]]+)\]?$/);
  const cls = m?.[1] ?? raw.replace(/[[\]]/g, '');
  const inst = m?.[2];
  const base = inst && inst !== cls ? inst : cls;
  return base.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

export function AeroAnalysis() {
  const { t } = useTranslation();
  const u = useUnits();
  const rocket = useWorkspaceStore((s) => s.rocket);
  const info = useWorkspaceStore((s) => s.info);
  // Which motor the POWER-ON curve belongs to.
  //
  // Everything else here is geometry -- power-off Cd, the friction/pressure/base
  // split, CP, CNa, the roll coefficients -- and does not depend on the motor at
  // all. The one exception is the power-on curve, which the kernel builds from
  // the stage's nozzle exit diameter applied to the seated motor's config
  // (OpenRocketEngine.applyMotor). The panel has no motor selector of its own
  // -- it analyses whatever the active simulation has loaded, which is our
  // equivalent of the desktop dialog's motor-configuration dropdown -- so when
  // that curve is on screen, say whose it is.
  const motorName = useWorkspaceStore((s) => selectActive(s).motor?.designation);
  // M1 by default: the overwhelming majority of hobby flights never reach Mach 1,
  // and sweeping to M3 spent two thirds of the x axis on speeds the rocket will
  // not see, squeezing the subsonic rise nobody could then read.
  const [machMax, setMachMax] = useState(1);
  const [cpPct, setCpPct] = useState(false);
  const [hoverM, setHoverM] = useState<number | null>(null);
  const [pane, setPane] = useState<'charts' | 'components'>('charts');
  // The Mach the tables report at. Hovering a chart parks it there too, so
  // switching to the tables lands on the point you were just looking at rather
  // than resetting -- the crosshair and the slider drive the same value.
  const [machPick, setMachPick] = useState(0.3);
  // The flight conditions the whole sweep is flown at. All three default to the
  // values every sweep used before they were exposed, so the panel opens
  // showing exactly what it showed before.
  const [aoaDeg, setAoaDeg] = useState(0);
  const [thetaDeg, setThetaDeg] = useState(0);
  const [rollRate, setRollRate] = useState(0);

  const sweep = useMemo<AeroSweep | null>(() => {
    if (!rocket) return null;
    try {
      // Finer steps over a shorter sweep: M1 at 0.02 is 48 samples, fewer than
      // the 59 the old M3 default already asked for, and it puts the resolution
      // where a subsonic rocket's drag actually moves — the rise from ~0.8.
      const machStep = machMax <= 1 ? 0.02 : machMax > 3 ? 0.1 : 0.05;
      return rocket.aeroSweep({ machMin: 0.05, machMax, machStep, aoaDeg, thetaDeg, rollRate });
    } catch {
      return null;
    }
  }, [rocket, machMax, aoaDeg, thetaDeg, rollRate]);

  useEffect(() => {
    if (hoverM != null) setMachPick(hoverM);
  }, [hoverM]);
  // The crosshair wins while it exists; the slider is the resting value.
  const tableMach = hoverM ?? machPick;

  // Mass does not vary with Mach, so this is keyed on the rocket alone rather
  // than recomputed with every sweep.
  const masses = useMemo<ComponentMass[]>(() => {
    if (!rocket) return [];
    try {
      return rocket.componentMasses();
    } catch {
      return [];
    }
  }, [rocket]);

  if (!sweep)
    return <div className="grid h-full place-items-center text-sm text-slate-500">{t('aero.unavailable')}</div>;

  const machs = sweep.machs;
  const machMin = machs[0] ?? 0.05;

  const cdSeries: Series[] = [{ name: t('aero.powerOff'), color: POWER_OFF, values: sweep.powerOff.total }];
  if (sweep.hasNozzle) cdSeries.push({ name: t('aero.powerOn'), color: POWER_ON, values: sweep.powerOn.total });

  // By type only. A per-component version of this chart used to sit behind a
  // toggle here, but the Per component pane now tabulates the same figures with
  // the pressure / base / friction split beside them -- which a stack of lines,
  // one per part, could never show. Two ways to read one thing, the worse one
  // taking a control.
  const breakdown: Series[] = [
    { name: t('aero.friction'), color: CAT[0]!, values: sweep.powerOff.friction },
    { name: t('aero.pressure'), color: CAT[1]!, values: sweep.powerOff.pressure },
    { name: t('aero.base'), color: CAT[2]!, values: sweep.powerOff.base },
  ];

  const bodyLen = info?.length ?? 0;
  // As a percentage of body length CP has no unit; as a position it takes the
  // user's length unit (`factor`, since a whole series is being scaled).
  const cpValues =
    cpPct && bodyLen > 0 ? sweep.cp.map((v) => (v / bodyLen) * 100) : sweep.cp.map((v) => v * u.factor('length'));
  const cpSeries: Series[] = [{ name: t('flight.cp'), color: POWER_OFF, values: cpValues }];

  return (
    <div className="flex h-full flex-col rounded-xl bg-slate-900 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2 pt-3">
        <h2 className="mr-auto text-xs font-semibold uppercase tracking-wide text-slate-400">{t('aero.title')}</h2>
        <Seg
          options={['charts', 'components'] as const}
          value={pane}
          onChange={setPane}
          fmt={(v) => t(v === 'charts' ? 'aero.charts' : 'aero.perComponent')}
        />
        {sweep?.hasNozzle && motorName && (
          <span className="text-[10px] text-slate-500" title={t('aero.powerOnMotorNote')}>
            {t('aero.powerOnMotor', { motor: motorName })}
          </span>
        )}
        <span className="text-[10px] text-slate-500">{t('aero.maxMach')}</span>
        <Seg options={[1, 2, 3, 5] as const} value={machMax} onChange={setMachMax} fmt={(v) => `M${v}`} />
        <button
          onClick={() => download('aero-table.csv', aeroTableCsv(sweep, u.all), CSV_MIME)}
          title={t('aero.exportCsv')}
          className="rounded-md bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
        >
          ⬇ CSV
        </button>
      </div>
      {/* The conditions the sweep is flown at. Changing one re-runs it, the
          same way Max Mach already does. */}
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
            // Wrapped like its neighbours (:77-85, :98-102): a kernel that throws
            // here — an older build without the method, or a degenerate design —
            // would otherwise throw out of a React event handler and take the
            // whole pane down rather than leaving the field alone.
            onClick={() => {
              if (!rocket) return;
              try {
                setThetaDeg(Math.round(rocket.worstThetaDeg(machPick, aoaDeg) * 10) / 10);
              } catch {
                /* leave the wind direction as it is */
              }
            }}
            title={t('aero.worstNote')}
            className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-slate-700"
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
      </div>

      {/* The Mach both panes report at. It used to be hidden on the Charts pane,
          on the reasoning that the hover crosshair already picks it — but that
          made the value pointer-only there: the legend readout was the sole way
          to read a figure at a given Mach and nothing could reach it from the
          keyboard. It shows on both panes now, and the crosshair still drives
          the same state when you do use a pointer. */}
      <div className="flex items-center gap-2 px-3 pb-2">
        <span className="shrink-0 text-[10px] text-slate-500">{t('aero.atMach', { mach: fmtNum(machPick, 2) })}</span>
        <input
          type="range"
          min={machs[0] ?? 0}
          max={machs[machs.length - 1] ?? 1}
          // Step by the sweep's own sampling, so the slider can only land on a
          // Mach that was actually computed — otherwise it reads 0.30 while
          // the tables, which snap to the nearest sample, read 0.29.
          step={(machs[1] ?? 0.05) - (machs[0] ?? 0)}
          value={machPick}
          onChange={(e) => setMachPick(parseFloat(e.target.value))}
          aria-label={t('aero.machPicker')}
          className="w-full accent-sky-500"
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
              setHoverM={setHoverM}
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
              setHoverM={setHoverM}
            />
            <ChartCard
              title={t('aero.cpVsMach')}
              machs={machs}
              machMin={machMin}
              machMax={machMax}
              series={cpSeries}
              unit={cpPct ? '%' : u.sym('length')}
              digits={1}
              hoverM={hoverM}
              setHoverM={setHoverM}
              note={t('aero.supersonicNote')}
              right={
                <Seg
                  options={[false, true] as const}
                  value={cpPct}
                  onChange={setCpPct}
                  fmt={(v) => (v ? t('aero.pctBody') : u.sym('length'))}
                  disabled={bodyLen <= 0}
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
            />
            <RollTable sweep={sweep} machs={machs} mach={tableMach} />
          </>
        )}
      </div>
    </div>
  );
}

export type HeatStyle = 'sky' | 'openrocket';

/** HSV to CSS rgb, matching java.awt.Color.getHSBColor. */
function hsv(h: number, sat: number, val: number): string {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.round(255 * (val - val * sat * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `rgb(${f(5)}, ${f(3)}, ${f(1)})`;
}

/**
 * Cell shading for a magnitude. Two styles, because which one reads faster is a
 * matter of taste and of what you are already used to.
 *
 * `sky` (default) is ONE hue that strengthens with the value, scaled against the
 * row set's own largest — a magnitude ramp, which is what these numbers are, and
 * it sits on our dark table without fighting it. It is capped short of opaque so
 * the text keeps its own colour.
 *
 * `openrocket` is the desktop's renderer, formula for formula: hue rotates green
 * to red over an ABSOLUTE Cd scale (full red at 1.5), saturation climbs with it,
 * value pinned at 1. That means light cells, so the text goes dark with them —
 * the same trade the desktop makes.
 */
function heat(value: number, max: number, style: HeatStyle): React.CSSProperties | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;

  if (style === 'openrocket') {
    const r = value / 1.5;
    const hue = Math.max(0, Math.min(0.3333 * (1 - 2 * r), 0.3333));
    const sat = Math.max(0, Math.min(0.8 * r + 0.1 * (1 - r), 1));
    return { backgroundColor: hsv(hue, sat, 1), color: '#000' };
  }

  if (!(max > 0)) return undefined;
  const a = Math.min(1, value / max) * 0.55;
  return { backgroundColor: `rgba(2, 132, 199, ${a.toFixed(3)})` };
}

/** The ramp, shown once so the shading is readable rather than decorative. */
function HeatLegend({ max, unit, style }: { max: number; unit: string; style: HeatStyle }) {
  const { t } = useTranslation();
  const { update } = useSettings();
  // The two styles are scaled against different things, so the legend has to say
  // which: the row set's own largest, or OpenRocket's fixed full-red-at-1.5.
  const top = style === 'openrocket' ? 1.5 : max;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pt-1.5 text-[10px] text-slate-600">
      <span>{style === 'openrocket' ? t('aero.absolute') : t('aero.share')}</span>
      <span className="flex overflow-hidden rounded-sm ring-1 ring-white/10">
        {[0.2, 0.4, 0.6, 0.8, 1].map((f) => (
          <span key={f} className="h-2.5 w-4" style={heat(f * top, top, style)} />
        ))}
      </span>
      <span className="tabular-nums">
        0 &ndash; {fmtNum(top, 3)} {unit}
      </span>
      {/* The switch sits ON the legend, which is the thing it changes -- rather
          than only in Settings, where you would have to go looking for it. It
          writes the same preference, so the two stay in step and it sticks. */}
      <span className="ml-auto flex items-center gap-1">
        {(['sky', 'openrocket'] as const).map((v) => (
          <button
            key={v}
            onClick={() => update({ aeroHeat: v })}
            aria-pressed={style === v}
            title={t('settings.aeroHeatNote')}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-white/10 ${
              style === v ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {t(v === 'sky' ? 'settings.aeroHeatSky' : 'settings.aeroHeatOr')}
          </button>
        ))}
      </span>
    </div>
  );
}

/**
 * Per-component drag at ONE Mach — the table behind OpenRocket's Component
 * Analysis "Drag characteristics" tab.
 *
 * Where the desktop makes you type a Mach number into a spinner, this follows
 * the charts' hover crosshair: scrub along the Cd curve and the split updates
 * under it. Every Mach in the sweep is already in hand, so it costs nothing.
 * With no pointer on a chart it settles at Mach 0.3, the same speed the stats
 * strip quotes its drag coefficient at.
 *
 * The friction / pressure / base columns appear only when the kernel supplies
 * them: they come from the same `getForceAnalysis` call as `cd`, but a kernel
 * built before they were added omits them rather than reporting zeros.
 */
/**
 * The sampled Mach nearest the crosshair. The tables quote a real sample rather
 * than interpolating between two, so their numbers match the CSV exactly; with
 * no pointer on a chart they settle at Mach 0.3, the speed the stats strip
 * quotes its drag coefficient at.
 */
function useSampleAt(machs: number[], mach: number): number {
  return useMemo(() => {
    const target = mach;
    let best = 0;
    for (let k = 1; k < machs.length; k++) {
      if (Math.abs(machs[k]! - target) < Math.abs(machs[best]! - target)) best = k;
    }
    return best;
  }, [machs, mach]);
}

/** Shared heading: what the table is, which Mach it is showing, and why it moves. */
function TableHead({ title, mach }: { title: string; mach: number }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-baseline gap-2 px-1 pb-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <span className="text-[10px] tabular-nums text-slate-500">{t('aero.atMach', { mach: fmtNum(mach, 2) })}</span>
    </div>
  );
}

function ComponentTable({ sweep, machs, mach }: { sweep: AeroSweep; machs: number[]; mach: number }) {
  const { t } = useTranslation();
  const heatStyle = useSettings().settings.aeroHeat;
  const i = useSampleAt(machs, mach);

  const hasSplit = sweep.components.some((c) => c.friction || c.pressure || c.base);
  const totalCd = sweep.powerOff.total[i] ?? 0;
  // Rounding aside, the component totals ARE the rocket's drag. The remainder
  // row only appears if that stops being true, which would mean the kernel had
  // started booking drag somewhere this walk does not reach.
  const attributed = sweep.components.reduce((a, c) => a + (c.cd[i] ?? 0), 0);
  const unattributed = totalCd - attributed;
  // Only worth a column when something actually has more than one of itself --
  // usually the fin set, and nothing else.
  const hasInstances = sweep.components.some((c) => (c.instances ?? 1) > 1);
  const pct = (v: number) => (totalCd ? `${((v / totalCd) * 100).toFixed(0)}%` : '—');
  const rows = useMemo(
    () =>
      sweep.components
        .map((c) => ({
          // The engine's stable id. Two parts can share a NAME (an unnamed
          // pair are both "Body tube"), so the label cannot be the row key.
          key: c.key ?? c.name,
          name: niceName(c.name),
          instances: c.instances ?? 1,
          cdInstance: c.cdInstance?.[i],
          cd: c.cd[i] ?? 0,
          friction: c.friction?.[i],
          pressure: c.pressure?.[i],
          base: c.base?.[i],
        }))
        .sort((a, b) => b.cd - a.cd), // the worst offender first: that is the question
    [sweep, i],
  );

  const num = (v: number | undefined, digits = 3) => (v == null ? '—' : fmtNum(v, digits));
  const cell = 'px-2 py-1 text-right tabular-nums';
  const head = 'px-2 py-1 text-right font-medium';

  return (
    <div className="rounded-lg bg-slate-950/40 p-2 ring-1 ring-white/10">
      <TableHead title={t('aero.dragByComponent')} mach={machs[i] ?? 0} />
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] text-slate-300">
          <thead className="text-slate-500">
            <tr className="border-b border-white/10">
              <th className="px-2 py-1 text-left font-medium">{t('aero.component')}</th>
              {hasSplit && <th className={head}>{t('aero.pressure')}</th>}
              {hasSplit && <th className={head}>{t('aero.base')}</th>}
              {hasSplit && <th className={head}>{t('aero.friction')}</th>}
              {hasInstances && <th className={head}>{t('aero.perInstance')}</th>}
              <th className={head}>Cd</th>
              <th className={head}>%</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-white/10 font-semibold text-slate-100">
              <td className="px-2 py-1 text-left">{t('aero.wholeRocket')}</td>
              {hasSplit && (
                <td className={cell} style={heat(sweep.powerOff.pressure[i] ?? 0, totalCd, heatStyle)}>
                  {num(sweep.powerOff.pressure[i])}
                </td>
              )}
              {hasSplit && (
                <td className={cell} style={heat(sweep.powerOff.base[i] ?? 0, totalCd, heatStyle)}>
                  {num(sweep.powerOff.base[i])}
                </td>
              )}
              {hasSplit && (
                <td className={cell} style={heat(sweep.powerOff.friction[i] ?? 0, totalCd, heatStyle)}>
                  {num(sweep.powerOff.friction[i])}
                </td>
              )}
              {hasInstances && <td className={cell}>—</td>}
              <td className={cell} style={heat(totalCd, totalCd, heatStyle)}>
                {num(totalCd)}
              </td>
              <td className={cell}>100%</td>
            </tr>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-white/5 last:border-0">
                <td className="px-2 py-1 text-left">{r.name}</td>
                {hasSplit && (
                  <td className={cell} style={heat(r.pressure ?? 0, totalCd, heatStyle)}>
                    {num(r.pressure)}
                  </td>
                )}
                {hasSplit && (
                  <td className={cell} style={heat(r.base ?? 0, totalCd, heatStyle)}>
                    {num(r.base)}
                  </td>
                )}
                {hasSplit && (
                  <td className={cell} style={heat(r.friction ?? 0, totalCd, heatStyle)}>
                    {num(r.friction)}
                  </td>
                )}
                {hasInstances && (
                  <td className={cell}>
                    {r.instances > 1 ? `${num(r.cdInstance)} × ${r.instances}` : num(r.cdInstance)}
                  </td>
                )}
                <td className={cell} style={heat(r.cd, totalCd, heatStyle)}>
                  {num(r.cd)}
                </td>
                <td className={`${cell} text-slate-500`}>{pct(r.cd)}</td>
              </tr>
            ))}
            {unattributed > 1e-6 && (
              <tr className="border-t border-white/10 text-slate-500">
                <td className="px-2 py-1 text-left italic">{t('aero.unattributed')}</td>
                {hasSplit && <td className={cell}>—</td>}
                {hasSplit && <td className={cell}>—</td>}
                {hasSplit && <td className={cell}>—</td>}
                {hasInstances && <td className={cell}>—</td>}
                <td className={cell}>{num(unattributed)}</td>
                <td className={cell}>{pct(unattributed)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <HeatLegend max={totalCd} unit="Cd" style={heatStyle} />
      {unattributed > 1e-6 && (
        <p className="px-1 pt-1.5 text-[10px] leading-snug text-slate-600">{t('aero.unattributedNote')}</p>
      )}
      {!hasSplit && <p className="px-1 pt-1.5 text-[10px] leading-snug text-slate-600">{t('aero.splitUnavailable')}</p>}
    </div>
  );
}

/**
 * Each component's share of the rocket's normal-force slope, and where its own
 * centre of pressure sits — the desktop's Component Analysis "Stability" tab.
 *
 * This is the table that answers "why is my CP there": a fin set carrying most
 * of the CNa is what holds the CP aft, and a nose cone contributing a couple of
 * units is what pulls it forward. Barrowman already reports a fin set's CNa for
 * the whole set, so unlike drag there is no per-instance multiplication here.
 */
function StabilityTable({
  sweep,
  machs,
  masses,
  mach,
  lengthUnit,
  lengthFactor,
  massUnit,
  massFactor,
}: {
  sweep: AeroSweep;
  machs: number[];
  mach: number;
  masses: ComponentMass[];
  lengthUnit: string;
  lengthFactor: number;
  massUnit: string;
  massFactor: number;
}) {
  const { t } = useTranslation();
  const heatStyle = useSettings().settings.aeroHeat;
  const i = useSampleAt(machs, mach);
  const hasCna = sweep.components.some((c) => c.cna);
  const totalCna = sweep.cna[i] ?? 0;
  // CNa is shaded by MAGNITUDE only, whatever the palette preference says.
  //
  // The `openrocket` ramp is not a generic heat scale: it is the desktop's
  // formula anchored to an ABSOLUTE Cd scale that reaches full red at 1.5. CNa
  // is not on that scale -- a fin set runs to 15 or 20 per radian -- so every
  // row above about 1.1 clamps to the same red and the column stops saying
  // anything. OpenRocket colours only its drag tab for exactly this reason.
  // The RollTable makes the same call, for the same reason.
  const cnaShaded = heatStyle !== 'openrocket';

  // Mass comes from a different engine call than the aero sweep. Keyed on the
  // engine's stable id, not the label: joining on the name gave two same-named
  // parts each other's mass.
  const massOf = useMemo(() => new Map(masses.map((m) => [m.key || m.name, m])), [masses]);
  const hasMass = masses.length > 0;

  const rows = useMemo(
    () =>
      sweep.components
        .map((c) => ({
          // The engine's stable id. Two parts can share a NAME (an unnamed
          // pair are both "Body tube"), so the label cannot be the row key.
          key: c.key ?? c.name,
          name: niceName(c.name),
          cna: c.cna?.[i] ?? 0,
          cp: c.cp?.[i] ?? 0,
          mass: massOf.get(c.key ?? c.name),
        }))
        .filter((r) => Math.abs(r.cna) > 1e-9) // a part with no normal force has no CP to report
        .sort((a, b) => b.cna - a.cna),
    [sweep, i, massOf],
  );
  if (!hasCna) return null;

  const cell = 'px-2 py-1 text-right tabular-nums';
  const head = 'px-2 py-1 text-right font-medium';
  const pct = (v: number) => (totalCna ? `${((v / totalCna) * 100).toFixed(0)}%` : '—');

  return (
    <div className="rounded-lg bg-slate-950/40 p-2 ring-1 ring-white/10">
      <TableHead title={t('aero.stabilityContribution')} mach={machs[i] ?? 0} />
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] text-slate-300">
          <thead className="text-slate-500">
            <tr className="border-b border-white/10">
              <th className="px-2 py-1 text-left font-medium">{t('aero.component')}</th>
              {hasMass && <th className={head}>{t('aero.eachMass', { unit: massUnit })}</th>}
              {hasMass && <th className={head}>{t('aero.totalMass', { unit: massUnit })}</th>}
              {hasMass && <th className={head}>{t('aero.cg', { unit: lengthUnit })}</th>}
              <th className={head}>CP ({lengthUnit})</th>
              <th className={head}>CNα</th>
              <th className={head}>%</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-white/10 font-semibold text-slate-100">
              <td className="px-2 py-1 text-left">{t('aero.wholeRocket')}</td>
              {hasMass && <td className={cell}>&mdash;</td>}
              {hasMass && <td className={cell}>&mdash;</td>}
              {hasMass && <td className={cell}>&mdash;</td>}
              <td className={cell}>{fmtNum((sweep.cp[i] ?? 0) * lengthFactor, 1)}</td>
              <td className={cell} style={cnaShaded ? heat(totalCna, totalCna, 'sky') : undefined}>
                {fmtNum(totalCna, 2)}
              </td>
              <td className={cell}>100%</td>
            </tr>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-white/5 last:border-0">
                <td className="px-2 py-1 text-left">{r.name}</td>
                {hasMass && <td className={cell}>{r.mass ? fmtNum(r.mass.eachMass * massFactor, 1) : '—'}</td>}
                {hasMass && <td className={cell}>{r.mass ? fmtNum(r.mass.mass * massFactor, 1) : '—'}</td>}
                {hasMass && <td className={cell}>{r.mass ? fmtNum(r.mass.cg * lengthFactor, 1) : '—'}</td>}
                <td className={cell}>{fmtNum(r.cp * lengthFactor, 1)}</td>
                <td className={cell} style={cnaShaded ? heat(r.cna, totalCna, 'sky') : undefined}>
                  {fmtNum(r.cna, 2)}
                </td>
                <td className={`${cell} text-slate-500`}>{pct(r.cna)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Roll forcing and damping per fin set — the desktop's Component Analysis "Roll
 * dynamics" tab.
 *
 * Shown for every fin set, whether or not it rolls. Both coefficients are zero
 * on an uncanted rocket flown at zero roll rate -- which is the default -- and
 * an earlier version hid the whole section in that case. That was wrong: it
 * meant most people never saw the table exist, and had no way to discover that
 * canting the fins or setting a roll rate would fill it in. The desktop shows
 * the zeros, and so do we.
 *
 * Fin sets are picked out by the kernel's class name, because their numbers at
 * rest are indistinguishable from a body tube's.
 */
function RollTable({ sweep, machs, mach }: { sweep: AeroSweep; machs: number[]; mach: number }) {
  const { t } = useTranslation();
  const heatStyle = useSettings().settings.aeroHeat;
  const i = useSampleAt(machs, mach);
  const rows = useMemo(
    () =>
      sweep.components
        .map((c) => ({
          // The engine's stable id. Two parts can share a NAME (an unnamed
          // pair are both "Body tube"), so the label cannot be the row key.
          key: c.key ?? c.name,
          name: niceName(c.name),
          type: c.type ?? '',
          force: c.rollForce?.[i] ?? 0,
          damp: c.rollDamp?.[i] ?? 0,
        }))
        // Fin sets are the only parts that generate or resist roll, which is
        // what the desktop lists. Anything with a non-zero coefficient is kept
        // too, so a kernel that starts attributing roll elsewhere is not hidden.
        .filter((r) => /FinSet/i.test(r.type) || Math.abs(r.force) > 1e-12 || Math.abs(r.damp) > 1e-12),
    [sweep, i],
  );
  if (rows.length === 0) return null;

  // Shading only earns its place with something to compare against: one fin set
  // is its own maximum, so every cell would sit at full tint and say nothing.
  // Each column is scaled against its OWN largest — forcing and damping are
  // different coefficients, and a shared scale would misrepresent the smaller.
  // `openrocket` style stays out of it: its ramp is an absolute Cd scale, which
  // roll coefficients are not on, and the desktop leaves this tab unshaded too.
  const shaded = rows.length > 1 && heatStyle !== 'openrocket';
  const maxForce = Math.max(...rows.map((r) => Math.abs(r.force)));
  const maxDamp = Math.max(...rows.map((r) => Math.abs(r.damp)));

  const cell = 'px-2 py-1 text-right tabular-nums';
  const head = 'px-2 py-1 text-right font-medium';
  return (
    <div className="rounded-lg bg-slate-950/40 p-2 ring-1 ring-white/10">
      <TableHead title={t('aero.rollDynamics')} mach={machs[i] ?? 0} />
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] text-slate-300">
          <thead className="text-slate-500">
            <tr className="border-b border-white/10">
              <th className="px-2 py-1 text-left font-medium">{t('aero.component')}</th>
              <th className={head}>{t('aero.rollForcing')}</th>
              <th className={head}>{t('aero.rollDamping')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-white/5 last:border-0">
                <td className="px-2 py-1 text-left">{r.name}</td>
                <td className={cell} style={shaded ? heat(Math.abs(r.force), maxForce, 'sky') : undefined}>
                  {fmtNum(r.force, 4)}
                </td>
                <td className={cell} style={shaded ? heat(Math.abs(r.damp), maxDamp, 'sky') : undefined}>
                  {fmtNum(r.damp, 4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shaded && (
        <div className="flex items-center gap-1.5 px-1 pt-1.5 text-[10px] text-slate-600">
          <span>{t('aero.columnShare')}</span>
          <span className="flex overflow-hidden rounded-sm ring-1 ring-white/10">
            {[0.2, 0.4, 0.6, 0.8, 1].map((f) => (
              <span key={f} className="h-2.5 w-4" style={heat(f, 1, 'sky')} />
            ))}
          </span>
        </div>
      )}
      <p className="px-1 pt-1.5 text-[10px] leading-snug text-slate-600">{t('aero.rollNote')}</p>
    </div>
  );
}

/**
 * One flight-condition input. A number box rather than a slider: these are
 * values you know and type (a 4-degree angle of attack, a 20 rad/s roll), not
 * ones you scrub for, and the Worst button writes an exact figure into one.
 */
function Num({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  unit: string;
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-[10px] text-slate-500">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        className="w-16 rounded-md bg-slate-800 px-1.5 py-0.5 text-right text-[11px] tabular-nums text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
      />
      <span className="text-[10px] text-slate-600">{unit}</span>
    </label>
  );
}

/**
 * SVG `d` for one series, skipping non-finite samples.
 *
 * Tracks whether a command has actually been EMITTED rather than taking the
 * letter from the array index. With `${i ? 'L' : 'M'}` a non-finite sample at
 * index 0 produced a `d` starting with `L…` — invalid path data, so the browser
 * silently drops the whole <path> and the curve renders blank with no error.
 * A gap mid-series starts a fresh `M` too, so a hole reads as a break instead
 * of a straight line bridging across it.
 *
 * Exported for its test; the chart passes its own scale functions in.
 */
export function buildLinePath(
  machs: number[],
  vals: number[],
  X: (m: number) => number,
  Y: (v: number) => number,
): string {
  const out: string[] = [];
  let open = false;
  machs.forEach((m, i) => {
    const v = vals[i] ?? NaN;
    if (!Number.isFinite(m) || !Number.isFinite(v)) {
      open = false;
      return;
    }
    out.push(`${open ? 'L' : 'M'}${X(m).toFixed(1)},${Y(v).toFixed(1)}`);
    open = true;
  });
  return out.join(' ');
}

function Seg<T extends string | number | boolean>({
  options,
  value,
  onChange,
  fmt,
  disabled,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  fmt: (v: T) => string;
  disabled?: boolean;
}) {
  return (
    <div
      className={`inline-flex overflow-hidden rounded-md ring-1 ring-white/10 ${disabled ? 'pointer-events-none opacity-40' : ''}`}
    >
      {options.map((o) => (
        <button
          key={String(o)}
          // `pointer-events-none` on the wrapper stops the mouse and nothing
          // else: without this the buttons stayed tabbable and Enter still
          // fired, so a "disabled" toggle could be flipped from the keyboard.
          disabled={disabled}
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={`px-2 py-0.5 text-[11px] font-medium ${value === o ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300'}`}
        >
          {fmt(o)}
        </button>
      ))}
    </div>
  );
}

function ChartCard({
  title,
  note,
  right,
  machs,
  machMin,
  machMax,
  series,
  stacked,
  unit,
  digits,
  hoverM,
  setHoverM,
}: {
  title: string;
  note?: string;
  right?: React.ReactNode;
  machs: number[];
  machMin: number;
  machMax: number;
  series: Series[];
  stacked?: boolean;
  unit: string;
  digits: number;
  hoverM: number | null;
  setHoverM: (m: number | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(520);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(Math.max(240, e[0]!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const iw = w - PAD_L - PAD_R,
    ih = CHART_H - PAD_T - PAD_B;
  const span = machMax - machMin || 1;
  const X = (m: number) => PAD_L + ((m - machMin) / span) * iw;

  let yMin = 0,
    yMax = 0;
  if (stacked) {
    for (let i = 0; i < machs.length; i++) {
      let s = 0;
      for (const se of series) s += Math.max(0, se.values[i] ?? 0);
      if (s > yMax) yMax = s;
    }
  } else {
    yMin = Infinity;
    yMax = -Infinity;
    for (const se of series)
      for (const v of se.values)
        if (Number.isFinite(v)) {
          if (v > yMax) yMax = v;
          if (v < yMin) yMin = v;
        }
    if (!Number.isFinite(yMax)) {
      yMax = 1;
      yMin = 0;
    }
    yMin = Math.min(0, yMin);
  }
  if (yMax === yMin) yMax = yMin + 1;
  yMax += (yMax - yMin) * 0.08;
  const Y = (v: number) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * ih;

  const linePath = (vals: number[]) => buildLinePath(machs, vals, X, Y);

  // Stacked areas: cumulative bottom→top, each band drawn as a filled polygon
  // with a thin surface stroke along its top edge (the dataviz 2px-gap rule).
  const bands: { fill: string; d: string }[] = [];
  if (stacked) {
    const cum = new Array<number>(machs.length).fill(0);
    for (const se of series) {
      const lower = cum.slice();
      for (let i = 0; i < machs.length; i++) cum[i] = (cum[i] ?? 0) + Math.max(0, se.values[i] ?? 0);
      const top = machs.map((m, i) => `${X(m).toFixed(1)},${Y(cum[i]!).toFixed(1)}`).join(' L');
      const bot = machs
        .map((m, i) => `${X(m).toFixed(1)},${Y(lower[i]!).toFixed(1)}`)
        .reverse()
        .join(' L');
      bands.push({ fill: se.color, d: `M${top} L${bot} Z` });
    }
  }

  // A sweep that ends at 1 is ticked in fifths, so its labels need a decimal;
  // whole Mach numbers do not. Rounding 0.2 to "0" was the axis reading
  // "M 0.1 0 0 1 1 1".
  const machDecimals = machMax <= 1 ? 1 : 0;
  const xTicks = useMemo(() => {
    // Whole Mach numbers are too sparse to label a sweep that ends at 1 — it
    // would carry two ticks for the whole axis.
    const step = machMax <= 1 ? 0.2 : 1;
    const ticks = [machMin];
    for (let m = step; m <= machMax + 1e-9; m += step) ticks.push(Number(m.toFixed(2)));
    return ticks;
  }, [machMin, machMax]);

  const onMove = (e: React.PointerEvent) => {
    const host = hostRef.current;
    if (!host) return;
    const x = e.clientX - host.getBoundingClientRect().left;
    setHoverM(Math.max(machMin, Math.min(machMax, machMin + ((x - PAD_L) / iw) * span)));
  };

  return (
    <div className="rounded-lg bg-slate-800/40 ring-1 ring-white/10">
      <div className="flex items-center gap-2 px-2 pt-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{title}</span>
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-2 pb-1 pt-1">
        {series.map((se, li) => {
          const val = hoverM != null ? lerpAt(machs, se.values, hoverM) : null;
          return (
            <span key={li} className="inline-flex items-center gap-1 text-[10px] text-slate-300">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: se.color }} />
              {se.name}
              {val != null && (
                <span className="tabular-nums text-slate-400">
                  · {fmtNum(val, digits)}
                  {unit && ` ${unit}`}
                </span>
              )}
            </span>
          );
        })}
      </div>
      <div ref={hostRef} onPointerMove={onMove} onPointerLeave={() => setHoverM(null)}>
        <svg viewBox={`0 0 ${w} ${CHART_H}`} width="100%" height={CHART_H} className="block">
          {[0, 1, 2].map((i) => {
            const yv = yMin + (yMax - yMin) * (i / 2);
            const gy = Y(yv);
            return (
              <g key={i}>
                <line x1={PAD_L} y1={gy} x2={w - PAD_R} y2={gy} className="stroke-white/10" />
                <text x={PAD_L - 4} y={gy + 3} textAnchor="end" className="fill-slate-500 text-[9px] tabular-nums">
                  {fmtNum(yv, digits)}
                </text>
              </g>
            );
          })}
          {stacked
            ? bands.map((b, i) => (
                <path
                  key={i}
                  d={b.d}
                  fill={b.fill}
                  fillOpacity={0.85}
                  stroke="#0f172a"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))
            : series.map((se, i) => (
                <path
                  key={i}
                  d={linePath(se.values)}
                  fill="none"
                  stroke={se.color}
                  strokeWidth={1.75}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
          {xTicks.map((m, i) => (
            <text
              key={i}
              x={X(m)}
              y={CHART_H - 5}
              textAnchor="middle"
              className="fill-slate-500 text-[9px] tabular-nums"
            >
              {i === 0 ? `M ${fmtNum(m, machDecimals)}` : fmtNum(m, machDecimals)}
            </text>
          ))}
          {hoverM != null && (
            <line
              x1={X(hoverM)}
              y1={PAD_T}
              x2={X(hoverM)}
              y2={CHART_H - PAD_B}
              className="stroke-slate-300/40"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      {note && <p className="px-2 pb-1.5 text-[9px] text-slate-500">{note}</p>}
    </div>
  );
}
