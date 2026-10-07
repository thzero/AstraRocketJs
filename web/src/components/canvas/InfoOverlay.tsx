import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import type { StaticInfo } from '../../engine/api';
import { stabilityState, stabilityToneOf } from '../../services/flight/simReport';
import { useUnits } from '../../prefs/useUnits';
import { STABILITY_GLYPH } from './schematicGeometry';

/**
 * Quick-glance readout box for the 2D/3D view: length, loaded
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
  // The engine's own figure, not ours: see StaticInfo.stabilityPercent.
  const pct = info.stabilityPercent;
  const rows: [string, React.ReactNode][] = [
    [t('stats.length'), `${u.fmtSym('length', info.length)}`],
    [t('stability.mass'), `${u.fmtSym('mass', info.mass)}`],
    [t('stability.cg'), `${u.fmtSym('length', info.cg)}`],
    [t('stability.cp'), `${u.fmtSym('length', info.cp)}`],
    [
      t('stability.onPad'),
      <span className={stabilityToneOf(state)}>
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
