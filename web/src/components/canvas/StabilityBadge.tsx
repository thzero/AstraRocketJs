import { useTranslation } from 'react-i18next';
import { fmtNum, fmtSig } from '../../i18n/format';
import type { StaticInfo } from '../../engine/api';
import { stabilityState, stabilityToneOf, stabilityVerdictKey } from '../../services/flight/simReport';
import { Stat } from '../common/Stat';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';

/**
 * "All stats" strip under the canvas: length, max diameter,
 * empty/loaded mass and CG, CP, and stability (calibers + % of length). All from
 * the live StaticInfo: empty = dry structure, loaded = with the seated motor.
 *
 * Collapsible: the header row is always shown (with a chevron + a compact
 * length·stability summary when collapsed); the full tile grid expands below it.
 * The expanded/collapsed state is a persisted preference (see `showStats`).
 */
export function StabilityBadge({
  info,
  recoveryWeight,
  recoveryEstimated,
  expanded,
  onToggle,
}: {
  info: StaticInfo | null;
  /** Descent mass (kg) = loaded − expelled propellant; undefined with no motor. */
  recoveryWeight?: number;
  /**
   * The recovery mass is the app's own arithmetic on the design rather than a
   * figure from a run, so the tile's label says so. False once a run has deployed
   * a device and the kernel's own mass has replaced it.
   */
  recoveryEstimated?: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  // Each tile carries its own unit, so reading CP in inches does not drag the
  // length tile, the tree and the rulers along with it.
  const lengthTile = u.at(unitScope('stats', 'length'), 'length');
  const diameterTile = u.at(unitScope('stats', 'maxDiameter'), 'length');
  const massTile = u.at(unitScope('stats', 'mass'), 'mass');
  const recoveryTile = u.at(unitScope('stats', 'recoveryWeight'), 'mass');
  const cgTile = u.at(unitScope('stats', 'cg'), 'length');
  const cpTile = u.at(unitScope('stats', 'cp'), 'length');
  if (!info) return null;
  const cal = info.stabilityCalibers;
  // Colored by band, as the drawing and the info card beside it are.
  const padTone = stabilityToneOf(stabilityState(cal) ?? 'under');
  // The engine's own figure, not ours: see StaticInfo.stabilityPercent.
  const pct = info.stabilityPercent;
  // Moments of inertia span orders of magnitude (roll ~1e-5, pitch ~1e-3 kg·m²);
  // exponential below 1e-4, 4-sig-fig fixed above, so both read cleanly.
  const fmtInertia = (v: number) => fmtSig(v, 4);
  return (
    <div className="@container mx-3 mb-3 mt-3">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        title={t('stats.title')}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-ink-soft hover:bg-raised/60"
      >
        <span className="w-3 shrink-0 text-[10px] leading-none text-ink-muted">{expanded ? '▾' : '▸'}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{t('stats.title')}</span>
        {/* Collapsed: keep the two headline numbers in view so hiding the grid
            still leaves the essentials (overall length + on-pad stability). */}
        {!expanded && (
          <span className="ml-auto truncate text-[11px] tabular-nums text-ink-muted">
            {lengthTile.fmt(info.length)} {lengthTile.sym} ·{' '}
            <span className={padTone}>
              {fmtNum(cal, 2)} {t('stability.caliber')}
            </span>
          </span>
        )}
      </button>
      {expanded && (
        /* Container queries: columns track this strip's width (see the @container
           parent), not the browser window, so the side panels don't throw the
           count off. <576px → 2, 576–1151 → 3, ≥1152 → 6. */
        <div className="mt-2 grid grid-cols-2 gap-2 @xl:grid-cols-3 @6xl:grid-cols-6">
          <Stat
            card
            label={t('stats.length')}
            value={lengthTile.fmt(info.length)}
            sub={<UnitChip label={t('stats.length')} quantity="length" scope={unitScope('stats', 'length')} />}
          />
          <Stat
            card
            label={t('stats.maxDiameter')}
            value={diameterTile.fmt(info.refDiameter)}
            sub={
              <UnitChip label={t('stats.maxDiameter')} quantity="length" scope={unitScope('stats', 'maxDiameter')} />
            }
          />
          <Stat
            card
            label={t('stability.mass')}
            value={`${massTile.fmt(info.massEmpty)} / ${massTile.fmt(info.mass)}`}
            sub={
              <>
                <UnitChip label={t('stability.mass')} quantity="mass" scope={unitScope('stats', 'mass')} /> ·{' '}
                {t('stats.emptyLoaded')}
              </>
            }
          />
          {/* What the recovery system brings down. Estimated from the design
              (loaded minus the propellant that burns off) until a run reports the
              kernel's own mass under the chute, which is also the only way to get
              it right on a staged design: a booster descends on its own branch.
              Needs a motor loaded to have propellant to subtract.

              The estimate is marked on the label rather than in place of the unit
              chip below: the chip is the control that sets this tile's unit, and
              a marker is not worth a control. */}
          <Stat
            card
            label={recoveryEstimated ? t('stats.recoveryWeightEstimated') : t('stats.recoveryWeight')}
            value={recoveryWeight != null ? recoveryTile.fmt(recoveryWeight) : '—'}
            sub={
              recoveryWeight != null ? (
                <UnitChip
                  label={t('stats.recoveryWeight')}
                  quantity="mass"
                  scope={unitScope('stats', 'recoveryWeight')}
                />
              ) : (
                t('stats.needsMotor')
              )
            }
          />
          <Stat
            card
            label={t('stability.cg')}
            value={`${cgTile.fmt(info.cgEmpty)} / ${cgTile.fmt(info.cg)}`}
            sub={
              <>
                <UnitChip label={t('stability.cg')} quantity="length" scope={unitScope('stats', 'cg')} /> ·{' '}
                {t('stats.emptyLoaded')}
              </>
            }
          />
          <Stat
            card
            label={t('stability.cp')}
            value={cpTile.fmt(info.cp)}
            sub={<UnitChip label={t('stability.cp')} quantity="length" scope={unitScope('stats', 'cp')} />}
          />
          <Stat
            card
            label={t('stats.fineness')}
            value={fmtNum(info.refDiameter > 0 ? info.length / info.refDiameter : 0, 1)}
            sub="L/D"
          />
          {/* One card, both conventions for the same margin: calibers and % of
              length as paired values (like Mass/CG's empty / loaded), with the
              verdict in the sub. */}
          <Stat
            card
            label={t('stability.onPad')}
            value={`${fmtNum(cal, 2)} / ${fmtNum(pct, 1)}`}
            sub={`${t('stability.caliber')} / % · ${t(stabilityVerdictKey(cal))}`}
            tone={padTone}
          />
          <Stat card label={t('stats.cd')} value={info.cd != null ? fmtNum(info.cd, 3) : '—'} sub="Ma 0.3" />
          {/* Symbol lives in the sub: the tile label is uppercased, which would
              turn the Greek α into Α (a plain "A"). */}
          <Stat card label={t('stats.cna')} value={fmtNum(info.cna, 2)} sub="CNα · rad⁻¹" />
          <Stat card label={t('stats.pitchInertia')} value={fmtInertia(info.pitchInertia)} sub="kg·m²" />
          <Stat card label={t('stats.rollInertia')} value={fmtInertia(info.rollInertia)} sub="kg·m²" />
        </div>
      )}
    </div>
  );
}
