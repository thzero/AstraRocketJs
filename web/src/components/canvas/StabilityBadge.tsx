import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import type { StaticInfo } from '../../engine/api';
import { stabilityTone, stabilityVerdictKey } from '../../services/simReport';
import { Stat } from '../common/Stat';

/**
 * "All stats" strip under the canvas (mmrocket-style): length, max diameter,
 * empty/loaded mass and CG, CP, and stability (calibers + % of length). All from
 * the live StaticInfo — empty = dry structure, loaded = with the seated motor.
 */
export function StabilityBadge({ info }: { info: StaticInfo | null }) {
  const { t } = useTranslation();
  if (!info) return null;
  const cal = info.stabilityCalibers;
  const pct = info.length > 0 ? ((info.cp - info.cg) / info.length) * 100 : 0;
  return (
    <div className="mx-3 mb-3 mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
      <Stat card label={t('stats.length')} value={fmtNum(info.length * 1000, 0)} sub="mm" />
      <Stat card label={t('stats.maxDiameter')} value={fmtNum(info.refDiameter * 1000, 0)} sub="mm" />
      <Stat card label={t('stats.massEmpty')} value={fmtNum(info.massEmpty * 1000, 0)} sub="g" />
      <Stat card label={t('stats.massLoaded')} value={fmtNum(info.mass * 1000, 0)} sub="g" />
      <Stat card label={t('stats.cgEmpty')} value={fmtNum(info.cgEmpty * 100, 1)} sub="cm" />
      <Stat card label={t('stats.cgLoaded')} value={fmtNum(info.cg * 100, 1)} sub="cm" />
      <Stat card label={t('stability.cp')} value={fmtNum(info.cp * 100, 1)} sub="cm" />
      <Stat card label={t('stats.fineness')} value={fmtNum(info.refDiameter > 0 ? info.length / info.refDiameter : 0, 1)} sub="L/D" />
      <Stat card label={t('stability.onPad')} value={fmtNum(cal, 2)} sub={`${t('stability.caliber')} · ${t(stabilityVerdictKey(cal))}`} tone={stabilityTone(cal)} />
      <Stat card label={t('stats.stabilityPct')} value={fmtNum(pct, 1)} sub="%" />
    </div>
  );
}
