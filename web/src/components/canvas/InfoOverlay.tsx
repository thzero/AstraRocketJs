import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import type { StaticInfo } from '../../engine/api';
import { stabilityState, type StabilityState } from '../../services/simReport';
import { useUnits } from '../../prefs/useUnits';
import { STABILITY_GLYPH } from './schematicGeometry';

/**
 * Tone per stability band. The SAME classifier as the 2D callout and the 3D
 * gadget beside this card (`stabilityState`: under < 1 cal, over > 6 cal, ok
 * between), so the three readouts on one screen never disagree about a design.
 * This card used to carry a third tier set (>= 1 ok, >= 0 warn, else) that
 * called a 7-caliber rocket fine while the drawing next to it said over-stable.
 */
const STABILITY_TONE: Record<StabilityState, string> = {
  ok: 'text-emerald-400',
  over: 'text-amber-400',
  under: 'text-red-400',
};

/**
 * Quick-glance readout box for the 2D/3D view (mmrocket-style): length, loaded
 * mass, CG, CP, and stability, as label→value rows. The fuller breakdown lives in
 * the "all stats" strip beneath the view.
 */
export function InfoOverlay({ info }: { info: StaticInfo | null }) {
  const { t } = useTranslation();
  const u = useUnits();
  if (!info) return null;
  const cal = info.stabilityCalibers;
  const state = stabilityState(cal) ?? 'under';
  // Margin as a fraction of overall length — the same figure the stat tiles and
  // the CP callout carry, so the quick-glance card isn't missing a data item.
  const pct = info.length > 0 ? ((info.cp - info.cg) / info.length) * 100 : 0;
  const rows: [string, React.ReactNode][] = [
    [t('stats.length'), `${u.fmt('length', info.length)} ${u.sym('length')}`],
    [t('stability.mass'), `${u.fmt('mass', info.mass)} ${u.sym('mass')}`],
    [t('stability.cg'), `${u.fmt('length', info.cg)} ${u.sym('length')}`],
    [t('stability.cp'), `${u.fmt('length', info.cp)} ${u.sym('length')}`],
    [
      t('stability.onPad'),
      <span className={STABILITY_TONE[state]}>
        {STABILITY_GLYPH[state]} {fmtNum(cal, 2)} {t('stability.caliber')} · {fmtNum(pct, 1)}%
      </span>,
    ],
  ];
  return (
    <div className="pointer-events-none rounded-lg bg-slate-900/85 px-3 py-2 ring-1 ring-white/10">
      <table className="border-separate border-spacing-x-3 border-spacing-y-0.5">
        <tbody>
          {rows.map(([label, value], i) => (
            <tr key={i}>
              <td className="text-[10px] uppercase tracking-wide text-slate-400">{label}</td>
              <td className="text-right text-xs font-semibold tabular-nums text-slate-100">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
