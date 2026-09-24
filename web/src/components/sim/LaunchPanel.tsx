import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { LaunchConditions } from '../../services/orkTree';
import { NumberInput } from '../common/NumberInput';
import { FieldLabel, markRing } from '../common/FieldMark';
import { isFilled, missingRequired, type RequiredLaunchKey } from '../../services/requiredLaunch';
import { UnitChip } from '../common/UnitChip';
import { useUnits, type Units } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { fmtUpTo, ladderDigits, withUnit } from '../../i18n/format';
import { LAUNCH_SI, type LaunchUnitKind } from '../../prefs/launchUnits';
import { MAX_ROD_ANGLE_RAD, MAX_WIND_SPEED_MS } from '../../services/safetyLimits';
import { G0 } from '../../services/motorMath';
import { hasIntensity, stdDevForIntensity, turbulenceIntensity, turbulenceLevel } from '../../services/windTurbulence';
import { WindProfileDialog } from './WindProfileDialog';
import { LocationPicker } from './LocationPicker';
import { SiteMapDialog } from './SiteMapDialog';

/**
 * Launch & atmosphere conditions for the flight simulation: wind (single average
 * or an altitude-layered multilevel profile), launch rod, launch site, base
 * atmosphere, and the Earth (geodetic) model. Emits a shallow patch on change;
 * App feeds these straight into simulate(). Populated from an imported .ork.
 */

function Num({
  label,
  unit,
  value,
  step = 1,
  min,
  max,
  placeholder,
  hint,
  mixed,
  required,
  missing,
  onChange,
}: {
  label: string;
  unit?: ReactNode;
  value: number | null;
  step?: number;
  min?: number;
  /** NumberInput clamps against this; without it a field is unbounded above. */
  max?: number;
  placeholder?: string;
  /** Why the field stops where it does. Rendered under the row. */
  hint?: string;
  /**
   * The simulations being edited together do not agree on this field. The box
   * shows the ACTIVE one's value, so without the marker a bulk edit would
   * flatten the others' values with nothing on screen to say so.
   */
  mixed?: boolean;
  /** A launch field a flight cannot be computed without. Marked always. */
  required?: boolean;
  /** ...and it is currently empty, which blocks the run. */
  missing?: boolean;
  onChange: (v: number | null) => void;
}) {
  if (hint) {
    return (
      <div>
        <Num
          label={label}
          unit={unit}
          value={value}
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          mixed={mixed}
          required={required}
          missing={missing}
          onChange={onChange}
        />
        <p className="mt-0.5 pr-24 text-[11px] leading-snug text-slate-500">{hint}</p>
      </div>
    );
  }
  return (
    <label className="flex items-center justify-between gap-3">
      <FieldLabel text={label} required={required} missing={missing} mixed={mixed} />
      <span className="flex items-center gap-1">
        <NumberInput
          ariaLabel={label}
          value={value}
          /* An empty REQUIRED box writes nothing, so the field simply keeps what
             it had. Not a focus trap -- tabbing away still works, which a trap
             would forbid (WCAG 2.1.2) and which would fight anyone clearing a
             field to retype it. NumberInput holds its own draft string while
             focused, so the box still LOOKS empty as you type; only the commit
             is withheld. An imported .ork that omits the field still arrives
             blank, which is what the marker and the run gate are for. */
          onChange={(v) => (v === null && required ? undefined : onChange(v))}
          step={step}
          min={min}
          max={max}
          placeholder={placeholder}
          className={markRing(
            'w-24 rounded-md bg-slate-800 px-2 py-1 text-right text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500',
            missing,
            mixed,
          )}
        />
        {unit && <span className="min-w-10 text-xs text-slate-500">{unit}</span>}
      </span>
    </label>
  );
}

/**
 * A launch-condition field in the user's chosen unit. `value`/`onChange` speak
 * the STORED convention (see SI above); `stepSi`/`minSi` are given in SI, so a
 * sensible 0.5 m/s or 10 m stays sensible once it is shown in ft/s or ft.
 */
function QNum({
  label,
  chipLabel,
  field,
  kind,
  u,
  value,
  stepSi,
  minSi,
  maxSi,
  placeholder,
  hint,
  mixed,
  required,
  missing,
  onChange,
}: {
  label: string;
  /**
   * Accessible name for the unit chip, when the visible label is ambiguous
   * OUTSIDE this panel. "Length" and "Direction" read fine under their group
   * headings, but a screen reader announces the chip on its own — and the stats
   * strip has its own "Length", so two chips on one screen announced the same.
   */
  chipLabel?: string;
  /** Names this launch field, so its unit is its own (see `unitScope`). */
  field: string;
  kind: LaunchUnitKind;
  u: Units;
  value: number | null;
  stepSi: number;
  minSi?: number;
  /** Upper bound in SI, converted like `minSi` so it holds in any unit. */
  maxSi?: number;
  placeholder?: string;
  hint?: string;
  /** See {@link Num}. */
  mixed?: boolean;
  /** See {@link Num}. */
  required?: boolean;
  /** See {@link Num}. */
  missing?: boolean;
  onChange: (v: number | null) => void;
}) {
  const c = LAUNCH_SI[kind];
  const scope = unitScope('launch', field);
  const fu = u.at(scope, c.q);
  return (
    <Num
      label={label}
      // The field's own label, not just the quantity: this panel shows three
      // ANGLE chips (rod angle, rod direction, wind direction) and two WIND
      // SPEED ones at once, which otherwise all announce identically.
      unit={<UnitChip label={chipLabel ?? label} quantity={c.q} scope={scope} />}
      step={fu.step(stepSi)}
      min={minSi !== undefined ? fu.toUi(minSi) : undefined}
      max={maxSi !== undefined ? fu.toUi(maxSi) : undefined}
      placeholder={placeholder}
      hint={hint}
      mixed={mixed}
      required={required}
      missing={missing}
      value={value === null ? null : fu.toUi(c.toSi(value))}
      onChange={(v) => onChange(v === null ? null : c.fromSi(fu.fromUi(v)))}
    />
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function LaunchPanel({
  launch,
  onChange,
  onCommit,
  diff,
}: {
  launch: LaunchConditions;
  onChange: (patch: Partial<LaunchConditions>) => void;
  /**
   * Launch keys the simulations being edited together disagree on, marked so a
   * bulk edit cannot flatten a value off screen. Empty/absent for the ordinary
   * single-simulation case and for the Settings copy, which edits one default.
   */
  diff?: ReadonlySet<keyof LaunchConditions>;
  /** Close the current edit's undo entry. Number fields commit via the panel's
   *  container blur (React blur bubbles); discrete controls commit immediately. */
  onCommit?: () => void;
}) {
  const { t } = useTranslation();
  const u = useUnits();
  /**
   * A safety-code cap in the unit ITS OWN FIELD is shown in — resolved the way
   * QNum resolves it, chip override included. A hint that quotes the rule in a
   * different unit than the box under it is worse than no hint.
   */
  const capFor = (kind: LaunchUnitKind, field: string, si: number) => {
    const fu = u.at(unitScope('launch', field), LAUNCH_SI[kind].q);
    const ui = fu.toUi(si);
    return withUnit(fmtUpTo(ui, ladderDigits(ui)), fu.sym);
  };
  const [profileOpen, setProfileOpen] = useState(false);
  // Geolocation is a 10 s round trip that can simply be refused, and both
  // outcomes used to be invisible: the error callback was an empty block and
  // there was no pending state, so pressing the button appeared to do nothing
  // and users pressed it again.
  const [locating, setLocating] = useState(false);
  const [locateErr, setLocateErr] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const mixed = (k: keyof LaunchConditions) => diff?.has(k) ?? false;
  // Empty required fields on the simulation being shown. The SETTINGS copy of
  // this panel never has any: it fills blanks from the previous default,
  // because a blank default would hand every future simulation a hole.
  const blank = useMemo(() => new Set<RequiredLaunchKey>(missingRequired(launch)), [launch]);
  /** The six are ALWAYS required; `missing` is the ones currently empty. */
  const req = (k: RequiredLaunchKey) => ({ required: true, missing: blank.has(k) });
  const levels = launch.windLevels ?? [];
  const multilevel = levels.length > 0;

  // Gustiness the way OpenRocket states it and the way the hobby talks about
  // it: scatter over average, named. The STORED value is still the m/s standard
  // deviation, so this and the deviation field are one number seen two ways.
  // The profile's per-level equivalent lives in the Wind Profile Editor.
  // Both halves have to be present for a ratio to exist. A blank reads as 0
  // here so the percentage field shows something rather than NaN; the blank
  // itself is reported by the required marker on the field it belongs to.
  const windAvg = isFilled(launch.windAverage) ? launch.windAverage : 0;
  const windSd = isFilled(launch.windStdDev) ? launch.windStdDev : 0;
  const intensity = turbulenceIntensity(windAvg, windSd);

  /**
   * Switch wind models. Multilevel is REPRESENTED by having levels, so turning
   * it on seeds one from the single wind (nothing typed is lost) and turning it
   * off drops them, which is what `simConditions` keys the engine's choice on.
   */
  const setWindModel = (model: 'average' | 'multilevel') => {
    if (model === 'average') return onChange({ windLevels: undefined });
    if (multilevel) return;
    onChange({
      windLevels: [
        {
          altitudeM: 0,
          speed: launch.windAverage || 0,
          directionDeg: launch.windDirectionDeg ?? 90,
          stddev: launch.windStdDev || 0,
        },
      ],
    });
  };

  return (
    // Container blur closes the undo entry for whichever number field was being
    // edited (React's onBlur bubbles from the focused input).
    // No padding of its own: every caller already sits in a padded column (the
    // sim editor, the Settings dialog body), and a second p-3 inset this panel's
    // cards relative to their siblings. The gap matches the sim editor's, so one
    // column of cards reads as one rhythm.
    <div className="space-y-4" onBlur={onCommit}>
      <Group title={t('launch.launchRod')}>
        <QNum
          label={t('launch.length')}
          chipLabel={t('launch.rodLengthName')}
          field="length"
          kind="length"
          u={u}
          stepSi={0.1}
          minSi={0}
          mixed={mixed('launchRodLengthM')}
          {...req('launchRodLengthM')}
          value={launch.launchRodLengthM}
          onChange={(v) => onChange({ launchRodLengthM: v })}
        />
        <QNum
          label={t('launch.angle')}
          field="angle"
          kind="deg"
          u={u}
          stepSi={Math.PI / 180}
          minSi={0}
          maxSi={MAX_ROD_ANGLE_RAD}
          hint={t('launch.angleLimit', { limit: capFor('deg', 'angle', MAX_ROD_ANGLE_RAD) })}
          mixed={mixed('launchRodAngleDeg')}
          {...req('launchRodAngleDeg')}
          value={launch.launchRodAngleDeg}
          onChange={(v) => onChange({ launchRodAngleDeg: v })}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={launch.launchIntoWind ?? false}
            onChange={(e) => {
              onChange({ launchIntoWind: e.target.checked });
              onCommit?.();
            }}
            className="accent-sky-500"
          />
          <span className="text-xs text-slate-400">{t('launch.intoWind')}</span>
        </label>
        {!launch.launchIntoWind && (
          <QNum
            label={t('launch.rodDirection')}
            chipLabel={t('launch.rodDirectionName')}
            field="rodDirection"
            kind="deg"
            u={u}
            stepSi={(5 * Math.PI) / 180}
            mixed={mixed('launchRodDirectionDeg')}
            value={launch.launchRodDirectionDeg ?? 90}
            // Cleared is CLEARED: the box shows 90
            // when unset, so writing 0 for an emptied field silently turned
            // the default east into north.
            onChange={(v) => onChange({ launchRodDirectionDeg: v ?? undefined })}
          />
        )}
      </Group>

      <Group title={t('launch.site')}>
        {/* Above the three fields it fills, because picking a saved location is the
            alternative to typing them rather than something you do after. */}
        <LocationPicker launch={launch} onChange={onChange} onCommit={onCommit} />
        <QNum
          label={t('launch.altitude')}
          field="altitude"
          kind="distance"
          u={u}
          stepSi={10}
          // Dead Sea shore to above any launch site: the kernel's atmosphere
          // model takes this straight, and it was one of two site fields left
          // unbounded after every sibling was given a range.
          minSi={-500}
          maxSi={10000}
          mixed={mixed('launchAltitudeM')}
          {...req('launchAltitudeM')}
          value={launch.launchAltitudeM}
          onChange={(v) => onChange({ launchAltitudeM: v })}
        />
        <Num
          label={t('launch.latitude')}
          unit="°"
          step={1}
          // Unbounded, these reached the kernel as launchLatitude (gravity and
          // Coriolis) AND flightPathExport as the KML/GPX origin, where a
          // latitude past ±90 is rejected outright by Google Earth.
          min={-90}
          max={90}
          mixed={mixed('latitudeDeg')}
          {...req('latitudeDeg')}
          value={launch.latitudeDeg}
          onChange={(v) => onChange({ latitudeDeg: v })}
        />
        <Num
          label={t('launch.longitude')}
          unit="°"
          step={1}
          min={-180}
          max={180}
          mixed={mixed('longitudeDeg')}
          {...req('longitudeDeg')}
          value={launch.longitudeDeg}
          onChange={(v) => onChange({ longitudeDeg: v })}
        />
        {'geolocation' in navigator && (
          <button
            onClick={() => {
              setLocateErr(null);
              setLocating(true);
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  setLocating(false);
                  setLocateErr(null);
                  onChange({
                    latitudeDeg: +pos.coords.latitude.toFixed(4),
                    longitudeDeg: +pos.coords.longitude.toFixed(4),
                  });
                  onCommit?.();
                },
                () => {
                  // Denial used to produce no visible change whatsoever, so
                  // the user pressed the button again. There is a 10 s
                  // timeout behind it too, with nothing on screen either way.
                  setLocating(false);
                  setLocateErr(t('launch.locationDenied'));
                },
                { timeout: 10000 },
              );
            }}
            disabled={locating}
            className="w-full rounded-md bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-slate-700 disabled:opacity-60"
          >
            📍 {locating ? t('launch.locating') : t('launch.useLocation')}
          </button>
        )}
        <button
          onClick={() => setMapOpen(true)}
          className="w-full rounded-md bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
        >
          🗺 {t('map.show')}
        </button>
        {/* Always mounted, empty until there is something to say: a live
            region created together with its text is not announced by most
            screen readers (see UpdateToast), so the refusal was silent to the
            people who cannot see the amber line. */}
        <p role="status" aria-live="polite" className="mt-1 text-[11px] leading-snug text-amber-400">
          {locateErr}
        </p>
        {mapOpen && (
          <SiteMapDialog
            latitudeDeg={launch.latitudeDeg}
            longitudeDeg={launch.longitudeDeg}
            onPick={(la, lo) => {
              onChange({ latitudeDeg: la, longitudeDeg: lo });
              onCommit?.();
            }}
            onClose={() => setMapOpen(false)}
          />
        )}
      </Group>

      <Group title={t('launch.atmosphere')}>
        <QNum
          label={t('launch.temperature')}
          field="temperature"
          kind="degC"
          // Below absolute zero is not a launch condition. These three were
          // the only QNums with neither bound while every sibling is bounded,
          // and they go straight to the kernel's atmosphere model.
          minSi={-90}
          maxSi={70}
          u={u}
          stepSi={1}
          placeholder={t('launch.isa')}
          mixed={mixed('temperatureC')}
          value={launch.temperatureC}
          onChange={(v) => onChange({ temperatureC: v })}
        />
        <QNum
          label={t('launch.pressure')}
          field="pressure"
          kind="hPa"
          u={u}
          stepSi={100}
          // Stored in hPa; bounds are SI (Pa), as for every QNum. 300 hPa is
          // the top of Everest, 1100 hPa is past any recorded surface high.
          minSi={30_000}
          maxSi={110_000}
          placeholder={t('launch.isa')}
          mixed={mixed('pressureHPa')}
          value={launch.pressureHPa}
          onChange={(v) => onChange({ pressureHPa: v })}
        />
        {/* Stored as the kernel's 0..1 fraction, typed as the percent everyone
            reads off a forecast. Blank is ISA, like the two fields above, and
            humidity alone is enough to leave standard: the bridge only keeps
            ISA when all three are absent. */}
        <Num
          label={t('launch.humidity')}
          unit="%"
          step={5}
          min={0}
          max={100}
          placeholder={t('launch.isa')}
          mixed={mixed('relativeHumidity')}
          value={launch.relativeHumidity == null ? null : Math.round(launch.relativeHumidity * 100)}
          onChange={(v) => onChange({ relativeHumidity: v == null ? null : v / 100 })}
        />
      </Group>

      <Group title={t('launch.wind')}>
        <fieldset className="pb-1">
          <legend className="sr-only">{t('launch.windModel')}</legend>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">{t('launch.windModel')}</span>
            <div className="flex gap-3">
              {(['average', 'multilevel'] as const).map((m) => (
                <label key={m} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="windModel"
                    checked={multilevel === (m === 'multilevel')}
                    onChange={() => {
                      setWindModel(m);
                      onCommit?.();
                    }}
                    className="accent-sky-500"
                  />
                  <span className="text-xs text-slate-400">{t(`launch.windModel_${m}`)}</span>
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        {!multilevel ? (
          <>
            <QNum
              label={t('launch.speed')}
              field="speed"
              kind="windspeed"
              u={u}
              stepSi={0.5}
              minSi={0}
              maxSi={MAX_WIND_SPEED_MS}
              hint={t('launch.windLimit', { limit: capFor('windspeed', 'speed', MAX_WIND_SPEED_MS) })}
              mixed={mixed('windAverage')}
              {...req('windAverage')}
              value={launch.windAverage}
              onChange={(v) => {
                // Cleared is CLEARED. It used to land as 0, which is a real
                // wind speed, so emptying the field quietly asserted still air.
                if (v == null) return onChange({ windAverage: null });
                // OpenRocket holds the turbulence INTENSITY constant when the
                // average moves (`PinkNoiseWindModel.setAverage`), so wind that
                // was 15% gusty stays 15% gusty instead of quietly becoming 5%
                // because the wind picked up. Skipped from a zero average,
                // where the ratio is the 0-or-1 stand-in rather than a real
                // fraction and rescaling would snap the scatter to the whole
                // wind speed.
                if (!hasIntensity(windAvg)) return onChange({ windAverage: v });
                onChange({ windAverage: v, windStdDev: stdDevForIntensity(v, intensity) });
              }}
            />
            <QNum
              label={t('launch.stdDev')}
              chipLabel={t('launch.stdDevName')}
              field="gusts"
              kind="windspeed"
              u={u}
              stepSi={0.5}
              minSi={0}
              mixed={mixed('windStdDev')}
              {...req('windStdDev')}
              value={launch.windStdDev}
              onChange={(v) => onChange({ windStdDev: v })}
            />
            {/* The same scatter as a percentage of the wind, which is the number
                the hobby actually quotes. Editable, as the desktop has it: the
                three fields are one value seen two ways, so typing 10% here
                rewrites the deviation exactly as typing the deviation rewrites
                this. Its descriptive name sits under it, as OpenRocket does. */}
            <Num
              label={t('launch.turbulenceIntensity')}
              unit="%"
              step={1}
              min={0}
              mixed={mixed('windStdDev')}
              value={Math.round(intensity * 100)}
              onChange={(v) => onChange({ windStdDev: stdDevForIntensity(windAvg, (v ?? 0) / 100) })}
            />
            <p className="-mt-1 pr-24 text-right text-xs text-slate-400">
              {t(`launch.turbulenceLevel.${turbulenceLevel(intensity)}`)}
            </p>
            <QNum
              label={t('launch.direction')}
              chipLabel={t('launch.windDirectionName')}
              field="direction"
              kind="deg"
              u={u}
              stepSi={(5 * Math.PI) / 180}
              mixed={mixed('windDirectionDeg')}
              value={launch.windDirectionDeg ?? 90}
              // See the rod direction: an emptied box goes back to unset.
              onChange={(v) => onChange({ windDirectionDeg: v ?? undefined })}
            />
          </>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">
              {t('launch.levelCount', { count: levels.length })}
              {' · '}
              {t(`windProfile.${launch.windAltitudeReference ?? 'msl'}Short`)}
            </p>
            <button
              onClick={() => setProfileOpen(true)}
              className="w-full rounded-md bg-slate-800 py-1.5 text-xs font-medium text-sky-300 ring-1 ring-white/10 hover:bg-slate-700"
            >
              {t('launch.editProfile')}
            </button>
          </div>
        )}
      </Group>

      <Group title={t('launch.earthModel')}>
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">{t('launch.geodetic')}</span>
          <select
            value={launch.geodetic ?? 'spherical'}
            onChange={(e) => {
              onChange({ geodetic: e.target.value as LaunchConditions['geodetic'] });
              onCommit?.();
            }}
            className="w-32 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
          >
            <option value="flat">{t('launch.flat')}</option>
            <option value="spherical">{t('launch.spherical')}</option>
            <option value="wgs84">{t('launch.wgs84')}</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">{t('launch.gravity')}</span>
          <select
            value={launch.gravityModel ?? 'wgs'}
            onChange={(e) => {
              onChange({ gravityModel: e.target.value as LaunchConditions['gravityModel'] });
              onCommit?.();
            }}
            className="w-32 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-white/10 focus:outline-none focus:ring-sky-500"
          >
            <option value="wgs">{t('launch.gravityWgs')}</option>
            <option value="constant">{t('launch.gravityConstant')}</option>
          </select>
        </label>
        {/* Only meaningful for the constant model, so only shown for it. */}
        {launch.gravityModel === 'constant' && (
          <QNum
            label={t('launch.gravityValue')}
            field="gravity"
            kind="accel"
            u={u}
            stepSi={0.01}
            minSi={0}
            mixed={mixed('constantGravity')}
            value={launch.constantGravity ?? G0}
            onChange={(v) => onChange({ constantGravity: v ?? G0 })}
          />
        )}
      </Group>

      {/* Mounted only while open: its error line and row keys reset by unmount. */}
      {profileOpen && (
        <WindProfileDialog
          launch={launch}
          onChange={onChange}
          onCommit={onCommit}
          onClose={() => setProfileOpen(false)}
        />
      )}
    </div>
  );
}
