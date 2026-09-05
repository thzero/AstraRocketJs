import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import type { StaticInfo } from '../../engine/api';
import { stabilityTone, stabilityVerdictKey } from '../../services/simReport';
import { Stat } from '../common/Stat';

/**
 * "All stats" strip under the canvas (mmrocket-style): length, max diameter,
 * empty/loaded mass and CG, CP, and stability (calibers + % of length). All from
 * the live StaticInfo — empty = dry structure, loaded = with the seated motor.
 *
 * Collapsible: the header row is always shown (with a chevron + a compact
 * length·stability summary when collapsed); the full tile grid expands below it.
 * The expanded/collapsed state is a persisted preference (see `showStats`).
 */
export function StabilityBadge({
  info,
  expanded,
  onToggle,
}: {
  info: StaticInfo | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  if (!info) return null;
  const cal = info.stabilityCalibers;
  const pct = info.length > 0 ? ((info.cp - info.cg) / info.length) * 100 : 0;
  // Moments of inertia span orders of magnitude (roll ~1e-5, pitch ~1e-3 kg·m²);
  // exponential below 1e-4, 4-sig-fig fixed above, so both read cleanly.
  const fmtInertia = (v: number) => {
    if (!Number.isFinite(v)) return '—';
    if (v === 0) return '0';
    return Math.abs(v) < 1e-4 ? v.toExponential(3) : String(Number(v.toPrecision(4)));
  };
  return (
    <div className="@container mx-3 mb-3 mt-3">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        title={t('stats.title')}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-slate-300 hover:bg-slate-800/60"
      >
        <span className="w-3 shrink-0 text-[10px] leading-none text-slate-400">{expanded ? '▾' : '▸'}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t('stats.title')}</span>
        {/* Collapsed: keep the two headline numbers in view so hiding the grid
            still leaves the essentials (overall length + on-pad stability). */}
        {!expanded && (
          <span className="ml-auto truncate text-[11px] tabular-nums text-slate-400">
            {fmtNum(info.length * 1000, 0)} mm ·{' '}
            <span className={stabilityTone(cal)}>
              {fmtNum(cal, 2)} {t('stability.caliber')}
            </span>
          </span>
        )}
      </button>
      {expanded && (
        /* Container queries: columns track THIS strip's width (see the @container
           parent), not the browser window — so the side panels don't throw the
           count off. <576px → 2, 576–1151 → 3, ≥1152 → 6. */
        <div className="mt-2 grid grid-cols-2 gap-2 @xl:grid-cols-3 @6xl:grid-cols-6">
          <Stat card label={t('stats.length')} value={fmtNum(info.length * 1000, 0)} sub="mm" />
          <Stat card label={t('stats.maxDiameter')} value={fmtNum(info.refDiameter * 1000, 0)} sub="mm" />
          <Stat
            card
            label={t('stability.mass')}
            value={`${fmtNum(info.massEmpty * 1000, 0)} / ${fmtNum(info.mass * 1000, 0)}`}
            sub={`g · ${t('stats.emptyLoaded')}`}
          />
          <Stat
            card
            label={t('stability.cg')}
            value={`${fmtNum(info.cgEmpty * 100, 1)} / ${fmtNum(info.cg * 100, 1)}`}
            sub={`cm · ${t('stats.emptyLoaded')}`}
          />
          <Stat card label={t('stability.cp')} value={fmtNum(info.cp * 100, 1)} sub="cm" />
          <Stat
            card
            label={t('stats.fineness')}
            value={fmtNum(info.refDiameter > 0 ? info.length / info.refDiameter : 0, 1)}
            sub="L/D"
          />
          <Stat
            card
            label={t('stability.onPad')}
            value={fmtNum(cal, 2)}
            sub={`${t('stability.caliber')} · ${t(stabilityVerdictKey(cal))}`}
            tone={stabilityTone(cal)}
          />
          <Stat card label={t('stats.stabilityPct')} value={fmtNum(pct, 1)} sub="%" />
          <Stat card label={t('stats.cd')} value={info.cd != null ? fmtNum(info.cd, 3) : '—'} sub="Ma 0.3" />
          {/* Symbol lives in the sub — the tile label is uppercased, which would
              turn the Greek α into Α (a plain "A"). */}
          <Stat card label={t('stats.cna')} value={fmtNum(info.cna, 2)} sub="CNα · rad⁻¹" />
          <Stat card label={t('stats.pitchInertia')} value={fmtInertia(info.pitchInertia)} sub="kg·m²" />
          <Stat card label={t('stats.rollInertia')} value={fmtInertia(info.rollInertia)} sub="kg·m²" />
        </div>
      )}
    </div>
  );
}
