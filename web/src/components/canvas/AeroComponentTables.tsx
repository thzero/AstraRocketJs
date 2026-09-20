import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../state/SettingsProvider';
import { fmtNum } from '../../i18n/format';
import type { ComponentMass, AeroSweep } from '../../engine/openRocketEngine';
import {
  columnMax,
  dragRows,
  dragTotals,
  heat,
  massIndex,
  nearestSampleIndex,
  rollRows,
  stabilityRows,
  type HeatStyle,
} from './aeroTables';

/**
 * The AeroAnalysis "Per component" pane: the three tables that report one
 * Mach of the sweep per part (drag, stability contribution, roll dynamics)
 * and the heat legend they share. The pure row builders they tabulate are in
 * aeroTables.ts; this file is the markup. Named apart from that file because
 * the two would otherwise differ only by case, which a case-insensitive
 * filesystem resolves to whichever it finds first.
 */

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
 * The sampled Mach nearest the crosshair. The tables quote a real sample rather
 * than interpolating between two, so their numbers match the CSV exactly; with
 * no pointer on a chart they settle at Mach 0.3, the speed the stats strip
 * quotes its drag coefficient at.
 */
function useSampleAt(machs: number[], mach: number): number {
  return useMemo(() => nearestSampleIndex(machs, mach), [machs, mach]);
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
export function ComponentTable({ sweep, machs, mach }: { sweep: AeroSweep; machs: number[]; mach: number }) {
  const { t } = useTranslation();
  const heatStyle = useSettings().settings.aeroHeat;
  const i = useSampleAt(machs, mach);

  // Rounding aside, the component totals ARE the rocket's drag. The remainder
  // row only appears if that stops being true, which would mean the kernel had
  // started booking drag somewhere the walk does not reach. The instance
  // column is only worth having when something actually has more than one of
  // itself -- usually the fin set, and nothing else.
  const { totalCd, unattributed, hasSplit, hasInstances } = useMemo(() => dragTotals(sweep, i), [sweep, i]);
  const pct = (v: number) => (totalCd ? `${((v / totalCd) * 100).toFixed(0)}%` : '—');
  const rows = useMemo(() => dragRows(sweep, i), [sweep, i]);

  // `number | null`: a null cell is the kernel saying this reading was not
  // finite, which must read as an em dash and NOT as a fabricated 0 — a
  // component that genuinely makes no drag reports 0 and means it. `v == null`
  // already catches both; only the type was too narrow.
  const num = (v: number | null | undefined, digits = 3) => (v == null ? '—' : fmtNum(v, digits));
  const cell = 'px-2 py-1 text-right tabular-nums';
  const head = 'px-2 py-1 text-right font-medium';

  return (
    <div className="rounded-lg bg-slate-950/40 p-2 ring-1 ring-white/10">
      <TableHead title={t('aero.dragByComponent')} mach={machs[i] ?? 0} />
      {!!sweep.nonFinite && (
        // The kernel met a reading it could not compute. Those cells come back
        // null and print as an em dash, but a column SUM coerces null to 0 — so
        // without this the breakdown would quietly stop adding up to the rocket
        // totals above it, which is the whole failure this counter exists for.
        <p className="px-2 pb-1 text-[11px] text-amber-400">{t('aero.nonFinite', { count: sweep.nonFinite })}</p>
      )}
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
 * center of pressure sits — the desktop's Component Analysis "Stability" tab.
 *
 * This is the table that answers "why is my CP there": a fin set carrying most
 * of the CNa is what holds the CP aft, and a nose cone contributing a couple of
 * units is what pulls it forward. Barrowman already reports a fin set's CNa for
 * the whole set, so unlike drag there is no per-instance multiplication here.
 */
export function StabilityTable({
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
  // anything. OpenRocket colors only its drag tab for exactly this reason.
  // The RollTable makes the same call, for the same reason.
  const cnaShaded = heatStyle !== 'openrocket';

  // Mass comes from a different engine call than the aero sweep; the join is
  // on the engine's stable id (see aeroTables.massIndex).
  const massOf = useMemo(() => massIndex(masses), [masses]);
  const hasMass = masses.length > 0;

  const rows = useMemo(() => stabilityRows(sweep, i, massOf), [sweep, i, massOf]);
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
export function RollTable({ sweep, machs, mach }: { sweep: AeroSweep; machs: number[]; mach: number }) {
  const { t } = useTranslation();
  const heatStyle = useSettings().settings.aeroHeat;
  const i = useSampleAt(machs, mach);
  const rows = useMemo(() => rollRows(sweep, i), [sweep, i]);
  if (rows.length === 0) return null;

  // Shading only earns its place with something to compare against: one fin set
  // is its own maximum, so every cell would sit at full tint and say nothing.
  // Each column is scaled against its OWN largest — forcing and damping are
  // different coefficients, and a shared scale would misrepresent the smaller.
  // `openrocket` style stays out of it: its ramp is an absolute Cd scale, which
  // roll coefficients are not on, and the desktop leaves this tab unshaded too.
  const shaded = rows.length > 1 && heatStyle !== 'openrocket';
  const maxForce = columnMax(rows.map((r) => r.force));
  const maxDamp = columnMax(rows.map((r) => r.damp));

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
