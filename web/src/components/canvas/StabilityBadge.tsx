import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import type { StaticInfo } from '../../engine/api';
import { Stat } from '../common/Stat';

/** Stability readout under the canvas: caliber margin (with verdict tone) + mass/CG/CP. */
export function StabilityBadge({ info }: { info: StaticInfo | null }) {
  const { t } = useTranslation();
  if (!info) return null;
  const cal = info.stabilityCalibers;
  const tone = cal >= 1 ? 'text-emerald-400' : cal >= 0 ? 'text-amber-400' : 'text-red-400';
  const verdict = cal >= 1 ? t('stability.stable') : cal >= 0 ? t('stability.marginal') : t('stability.unstable');
  return (
    <div className="mx-3 mt-3 grid grid-cols-4 gap-2 rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <Stat label={t('stability.title')} value={fmtNum(cal, 2)} sub={`${t('stability.caliber')} · ${verdict}`} tone={tone} />
      <Stat label={t('stability.mass')} value={fmtNum(info.mass * 1000, 0)} sub="g" />
      <Stat label={t('stability.cg')} value={fmtNum(info.cg * 100, 1)} sub="cm" />
      <Stat label={t('stability.cp')} value={fmtNum(info.cp * 100, 1)} sub="cm" />
    </div>
  );
}
