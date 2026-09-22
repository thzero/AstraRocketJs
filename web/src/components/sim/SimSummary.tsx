import { useTranslation } from 'react-i18next';
import { fmtNum } from '../../i18n/format';
import { UnitChip } from '../common/UnitChip';
import { useUnits } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import type { FlightResult } from '../../engine/api';
import { lerpAt } from '../../services/interpolate';
import { stabilityTone } from '../../services/simReport';
import { useSettings } from '../../state/SettingsProvider';
import { useHelpStore } from '../../state/helpStore';
import { Stat } from '../common/Stat';
import { WARNING_TONE } from './warningTone';

/** Last finite value of a (possibly gappy) series — the value at flight's end. */
function lastFinite(arr?: (number | null)[]): number | null {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * What the numbers above are and are not, as a card of its own under them.
 *
 * It rides with the MEASUREMENTS rather than living in a dialog or a first-run
 * gate, because the moment a reading can mislead somebody is the moment it is
 * being read. It says three things, in the order they are acted on: verify the
 * model against the rocket on the bench, know what the model never had (the
 * gaps are specific on purpose — "results are approximate" tells nobody which
 * failure to go and think about), and remember who actually calls the flight.
 *
 * Carded and at the same `text-xs` as the tiles, not a footnote: it started
 * life as an 11px line under the grid and read as fine print, which is exactly
 * how it would then be treated.
 *
 * The WHOLE card wears the shared warning tone (WARNING_TONE NORMAL, the same
 * amber as a kernel flight warning), plus the ⚠ glyph on its heading, because
 * all of it is a warning: nothing on this card is a result, and the one thing
 * the app can never flag from a results panel is the failure it did not model.
 * Saying so IS the flag. Note this does read as loud as a FlightWarnings row
 * while being present on every flight rather than only a problematic one; it is
 * amber on purpose, and the ⚠ carries the meaning for anyone who cannot use the
 * color.
 *
 * The one line that is a bare list of gaps is set bold + italic inside the
 * bullet, the way FlightWarnings pairs a warning's text with its explanation.
 *
 * The link opens the docs' Safety page in the in-app Help dialog rather than a
 * new tab. Somebody reading this card is looking at a flight they are about to
 * fly, quite possibly at the field, and the one thing that must not be required
 * to read the safety page is a network. The dialog serves it from the app's own
 * precache, and carries its own link to the published page for anyone who wants
 * the shareable URL.
 *
 * Underlined amber rather than the app's usual sky blue, which on this
 * background reads as a foreign element rather than this card's own way out.
 */
const BULLET = 'flex gap-2';

function SafetyCard() {
  const { t } = useTranslation();
  const openHelp = useHelpStore((s) => s.openHelp);
  return (
    <section aria-label={t('sim.safetyTitle')} className={`rounded-xl p-3 ring-1 ${WARNING_TONE.NORMAL}`}>
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide">
        <span aria-hidden>⚠</span>
        {t('sim.safetyTitle')}
      </div>
      <p className="text-xs font-semibold leading-snug">{t('sim.safetyLead')}</p>
      {/* Hanging bullets: the glyph is its own column so a wrapped line lines up
          under the text, not under the dot.
          Spelled out one <li> at a time rather than mapped over a key array —
          `t(\`sim.${key}\`)` would hide all three from keys.test.ts, whose whole
          job is to notice a string nothing references any more. The dynamic
          allowlist there is for sets the kernel or the catalog produces, not for
          three sentences written by hand. */}
      <ul className="mt-2 space-y-1.5 text-xs leading-snug opacity-90">
        <li className={BULLET}>
          <span aria-hidden>·</span>
          <span className="min-w-0">{t('sim.safetyVerify')}</span>
        </li>
        <li className={BULLET}>
          <span aria-hidden>·</span>
          {/* The gaps get the emphasis of the three: the other two are things
              you can go and do, and this one is the list of failures no number
              above will ever mention. */}
          <span className="min-w-0">
            <span className="font-semibold italic">{t('sim.safetyGaps')}</span>
            <span className="block italic">{t('sim.safetyGapsDetail')}</span>
          </span>
        </li>
        <li className={BULLET}>
          <span aria-hidden>·</span>
          <span className="min-w-0">{t('sim.safetyCode')}</span>
        </li>
      </ul>
      {/* The liability line. Plain-language restatement of the license's
          no-warranty and no-liability clauses, kept short so it reads as part
          of the card rather than a wall of legal text; the full version is on
          the Safety page the link below opens. */}
      <p className="mt-2 text-[11px] leading-snug opacity-80">{t('sim.safetyDisclaimer')}</p>
      {/* nowrap so the arrow cannot be orphaned onto a line of its own. */}
      <button
        onClick={() => openHelp('safety')}
        className="mt-2 inline-block whitespace-nowrap text-xs font-medium underline underline-offset-2 hover:no-underline"
      >
        {t('sim.safetyLink')} →
      </button>
    </section>
  );
}

/**
 * The active simulation's summary tiles: rod exit, static margin at rail exit,
 * optimum delay, times, apogee, deploy and landing speeds, downrange, and the
 * peaks.
 *
 * Its own component because it is read in two places — under the Run button on
 * the Simulations panel, and at the top of the mobile Results tab, where the
 * numbers belong beside the charts they describe rather than a tab away.
 */
export function SimSummary({ sim }: { sim: FlightResult | null }) {
  const { t } = useTranslation();
  const u = useUnits();
  // Each result tile owns its unit: reading apogee in feet should not drag
  // landing speed, downrange and the rest along with it.
  const rodExit = u.at(unitScope('sim', 'rodExit'), 'velocity');
  const railCpUnit = u.at(unitScope('sim', 'railCp'), 'length');
  const apogee = u.at(unitScope('sim', 'apogee'), 'distance');
  const deployVel = u.at(unitScope('sim', 'deployVelocity'), 'velocity');
  const landingVel = u.at(unitScope('sim', 'landing'), 'velocity');
  const downrangeUnit = u.at(unitScope('sim', 'downrange'), 'distance');
  const maxAccel = u.at(unitScope('sim', 'maxAccel'), 'acceleration');
  const maxSpeed = u.at(unitScope('sim', 'maxSpeed'), 'velocity');
  const { settings } = useSettings();
  const { deploymentSpeedWarn, railExitVelocityMin } = settings.simulation;
  const s = sim?.summary;
  // Safe-if-green thresholds (global settings): fast off the rail, gentle at deploy.
  const goodTone = 'text-emerald-400',
    warnTone = 'text-amber-400';
  // Static margin at the instant the rocket clears the rod/rail — the
  // flight-relevant figure (real velocity + partly-burned mass), vs. the on-pad
  // "Stability" tile (Mach 0.3, fully loaded). OpenRocket records the same
  // series but buries it at the "# Event LAUNCHROD" line of a data export.
  const rodTime = sim?.events.find((e) => e.type === 'LAUNCHROD')?.time;
  const railMargin = sim && rodTime != null ? lerpAt(sim.series.time, sim.series.stability, rodTime) : null;
  const railCp = sim && rodTime != null ? lerpAt(sim.series.time, sim.series.cpLocation, rodTime) : null;
  // Downrange (lateral) landing distance from the drift series' final point.
  const px = sim ? lastFinite(sim.series.Px) : null;
  const py = sim ? lastFinite(sim.series.Py) : null;
  const downrange = px != null && py != null ? Math.hypot(px, py) : null;
  if (!s) return null;
  return (
    // The tiles and the safety card are ONE block, so the card travels with the
    // numbers to every place the summary is mounted. The gap is the wrapper's,
    // matching FlightWarnings' spacing above rather than inheriting whatever
    // rhythm each parent happens to use.
    <div className="space-y-3">
      {/* A grid of CARDS, not a card of tiles: the same shape the rocket's
          static-stats strip uses, so a measurement reads the same wherever it
          is. Two columns, because this column is 380px and three squeezed
          "Static margin @ rail exit" onto four lines. */}
      <section aria-label={t('sims.summary')} className="grid grid-cols-2 gap-2">
        {/* Chronological: liftoff → boost → apogee → recovery → landing, then peaks. */}
        <Stat
          card
          label={t('sim.rodExit')}
          value={rodExit.fmt(s.launchRodVelocity, 1)}
          sub={<UnitChip label={t('sim.rodExit')} quantity="velocity" scope={unitScope('sim', 'rodExit')} />}
          // The threshold is stored in SI, so the comparison stays in SI —
          // only the number on screen changes unit.
          tone={s.launchRodVelocity >= railExitVelocityMin ? goodTone : warnTone}
        />
        {railMargin != null && (
          <Stat
            card
            label={t('sim.railMargin')}
            value={fmtNum(railMargin, 2)}
            sub={
              railCp != null ? (
                <>
                  {t('stability.caliber')} · CP {railCpUnit.fmt(railCp)}{' '}
                  <UnitChip label={t('sim.railMargin')} quantity="length" scope={unitScope('sim', 'railCp')} />
                </>
              ) : (
                t('stability.caliber')
              )
            }
            tone={stabilityTone(railMargin)}
          />
        )}
        {s.optimumDelay != null && <Stat card label={t('sim.optDelay')} value={fmtNum(s.optimumDelay, 1)} sub="s" />}
        <Stat card label={t('sim.toApogee')} value={fmtNum(s.timeToApogee, 1)} sub="s" />
        <Stat
          card
          label={t('sim.apogee')}
          value={apogee.fmt(s.maxAltitude)}
          sub={<UnitChip label={t('sim.apogee')} quantity="distance" scope={unitScope('sim', 'apogee')} />}
          tone="text-sky-400"
        />
        {s.deploymentVelocity != null && (
          <Stat
            card
            label={t('sim.deployVelocity')}
            value={deployVel.fmt(s.deploymentVelocity, 1)}
            sub={
              <UnitChip
                label={t('sim.deployVelocity')}
                quantity="velocity"
                scope={unitScope('sim', 'deployVelocity')}
              />
            }
            tone={s.deploymentVelocity < deploymentSpeedWarn ? goodTone : warnTone}
          />
        )}
        {Number.isFinite(s.groundHitVelocity) && (
          <Stat
            card
            label={t('sim.landing')}
            value={landingVel.fmt(s.groundHitVelocity, 1)}
            sub={<UnitChip label={t('sim.landing')} quantity="velocity" scope={unitScope('sim', 'landing')} />}
          />
        )}
        <Stat card label={t('sim.flightTime')} value={fmtNum(s.flightTime, 1)} sub="s" />
        {Number.isFinite(s.groundHitVelocity) && downrange != null && (
          <Stat
            card
            label={t('sim.downrange')}
            value={downrangeUnit.fmt(downrange)}
            sub={<UnitChip label={t('sim.downrange')} quantity="distance" scope={unitScope('sim', 'downrange')} />}
          />
        )}
        <Stat
          card
          label={t('sim.maxAccel')}
          value={maxAccel.fmt(s.maxAcceleration, 0)}
          sub={<UnitChip label={t('sim.maxAccel')} quantity="acceleration" scope={unitScope('sim', 'maxAccel')} />}
        />
        <Stat
          card
          label={t('sim.maxSpeed')}
          value={maxSpeed.fmt(s.maxVelocity, 0)}
          sub={<UnitChip label={t('sim.maxSpeed')} quantity="velocity" scope={unitScope('sim', 'maxSpeed')} />}
        />
        <Stat card label={t('sim.maxMach')} value={fmtNum(s.maxMachNumber, 2)} sub="Mach" />
      </section>
      <SafetyCard />
    </div>
  );
}
