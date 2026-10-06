import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LaunchConditions } from '../../services/design/orkTree';
import { isFilled, missingRequired, type RequiredLaunchKey } from '../../services/flight/requiredLaunch';
import { UnitChip } from '../common/UnitChip';
import { useUnits, type Units } from '../../prefs/useUnits';
import { unitScope } from '../../prefs/units';
import { onSi } from '../../prefs/entryValue';
import { fmtUpTo, ladderDigits, withUnit } from '../../i18n/format';
import { LAUNCH_SI, type LaunchUnitKind } from '../../prefs/launchUnits';
import { MAX_ROD_ANGLE_RAD, MAX_TURBULENCE_PERCENT, MAX_WIND_SPEED_MS } from '../../services/flight/safetyLimits';
import { G0 } from '../../services/motors/motorMath';
import {
  hasIntensity,
  retuneStdDev,
  stdDevForIntensity,
  turbulenceIntensity,
  turbulenceLevel,
} from '../../services/flight/windTurbulence';
import { WindProfileDialog } from './WindProfileDialog';
import { WeatherDialog } from './WeatherDialog';
import { WeatherSourceLine } from './WeatherSourceLine';
import { WeatherKeyField } from './WeatherKeyField';
import { LocationPicker } from './LocationPicker';
import { LAUNCH_SITE_LIMITS } from '../../services/storage/launchLocationStore';
import { SiteMapDialog } from './SiteMapDialog';
import { useLatest } from '../common/useLatest';
import { DEFAULT_HEADING_DEG } from '../../services/flight/simulations';
import { NumberRow } from '../common/NumberRow';
import { CardGroup } from '../common/CardGroup';
import { LatLonRows } from './LatLonRows';

/**
 * Launch & atmosphere conditions for the flight simulation: wind (single average
 * or an altitude-layered multilevel profile), launch rod, launch site, base
 * atmosphere, and the Earth (geodetic) model. Emits a shallow patch on change;
 * App feeds these straight into simulate(). Populated from an imported .ork.
 */

/**
 * A launch-condition field in the user's chosen unit. `value`/`onChange` speak
 * the STORED convention (see SI above); `stepSi`/`minSi` are given in SI, so a
 * sensible 0.5 m/s or 10 m stays sensible once it is shown in ft/s or ft.
 */
export function QNum({
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
    <NumberRow
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
      // Two legs: the box's unit to SI, then SI to what the field is STORED
      // in (degrees, Celsius, hPa). `onSi` checks both, so neither an entry
      // that overflows on conversion nor one that overflows on the way to the
      // stored convention reaches the launch conditions.
      onChange={onSi(fu, onChange, c.fromSi)}
    />
  );
}

export function LaunchPanel({
  launch,
  onChange,
  onCommit,
  diff,
  weather = false,
  weatherKey = false,
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
  /**
   * Offer the Weather dialog. The simulation editor does; the Settings copy,
   * which edits the defaults every future simulation starts from, does not: a
   * forecast is for one day at one site.
   */
  weather?: boolean;
  /**
   * Offer the Open-Meteo API key, at the bottom of the Atmosphere card. Only the
   * Settings copy does: the key is one setting for every simulation.
   */
  weatherKey?: boolean;
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
  const [weatherOpen, setWeatherOpen] = useState(false);
  // Opened from the source line's Refresh rather than the Get weather button.
  const [weatherRefresh, setWeatherRefresh] = useState(false);
  const atmosphereLevels = launch.atmosphereLevels ?? [];
  // Geolocation is a 10 s round trip that can simply be refused. Without a
  // pending state and a reported error, both outcomes are invisible and the
  // button appears to do nothing.
  const [locating, setLocating] = useState(false);
  const [locateErr, setLocateErr] = useState<string | null>(null);
  // Which "use my location" attempt is current: the prompt outlives the panel.
  const locate = useLatest();
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
          directionDeg: launch.windDirectionDeg ?? DEFAULT_HEADING_DEG,
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
      <CardGroup title={t('launch.launchRod')}>
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
            value={launch.launchRodDirectionDeg ?? DEFAULT_HEADING_DEG}
            // Cleared is CLEARED: the box shows 90
            // when unset, so writing 0 for an emptied field silently turned
            // the default east into north.
            onChange={(v) => onChange({ launchRodDirectionDeg: v ?? undefined })}
          />
        )}
      </CardGroup>

      <CardGroup title={t('launch.site')}>
        {/* Above the three fields it fills, because picking a saved location is the
            alternative to typing them rather than something you do after. */}
        <LocationPicker launch={launch} onChange={onChange} onCommit={onCommit} />
        <QNum
          label={t('launch.altitude')}
          field="altitude"
          kind="distance"
          u={u}
          stepSi={10}
          minSi={LAUNCH_SITE_LIMITS.launchAltitudeM.min}
          maxSi={LAUNCH_SITE_LIMITS.launchAltitudeM.max}
          mixed={mixed('launchAltitudeM')}
          {...req('launchAltitudeM')}
          value={launch.launchAltitudeM}
          onChange={(v) => onChange({ launchAltitudeM: v })}
        />
        <LatLonRows
          latitudeDeg={launch.latitudeDeg}
          longitudeDeg={launch.longitudeDeg}
          marks={(k) => ({ mixed: mixed(k), ...req(k) })}
          onChange={onChange}
        />
        {'geolocation' in navigator && (
          <button
            onClick={() => {
              setLocateErr(null);
              setLocating(true);
              // The browser's permission prompt can sit unanswered for minutes,
              // and `onChange` writes to whatever rows are the CURRENT edit
              // targets. Without this, allowing the prompt after switching
              // simulations put the launch site on the wrong one.
              const mine = locate.claim();
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  if (!mine()) return;
                  setLocating(false);
                  setLocateErr(null);
                  onChange({
                    latitudeDeg: +pos.coords.latitude.toFixed(4),
                    longitudeDeg: +pos.coords.longitude.toFixed(4),
                  });
                  onCommit?.();
                },
                () => {
                  if (!mine()) return;
                  // Denial is silent, and there is a 10 s timeout behind it,
                  // so the pending state has to be cleared on both paths or the
                  // button never settles.
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
      </CardGroup>

      <CardGroup title={t('launch.atmosphere')}>
        {weather && (
          <button
            onClick={() => {
              setWeatherRefresh(false);
              setWeatherOpen(true);
            }}
            className="w-full rounded-md bg-slate-800 px-2 py-1.5 text-xs font-medium text-sky-300 ring-1 ring-white/10 hover:bg-slate-700"
          >
            {t('launch.getWeather')}
          </button>
        )}
        <WeatherSourceLine
          launch={launch}
          onRefresh={
            weather
              ? () => {
                  setWeatherRefresh(true);
                  setWeatherOpen(true);
                }
              : undefined
          }
        />
        <QNum
          label={t('launch.temperature')}
          field="temperature"
          kind="degC"
          // -90 to 70 degrees C, below and above any recorded air temperature.
          // In KELVIN, because a QNum bound is SI: written as -90 and 70 they
          // capped every entry at 70 K, about -203 degrees C.
          minSi={LAUNCH_SI.degC.toSi(LAUNCH_SITE_LIMITS.temperatureC.min)}
          maxSi={LAUNCH_SI.degC.toSi(LAUNCH_SITE_LIMITS.temperatureC.max)}
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
        <NumberRow
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
        {/* A forecast atmosphere replaces the standard one above the site. It
            is shown and can be removed here, where the standard atmosphere's
            own fields are, so nothing flies that the panel does not show. */}
        {atmosphereLevels.length > 0 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">
              {t('launch.forecastProfile', {
                top: `${u.fmtSym('distance', atmosphereLevels[atmosphereLevels.length - 1]!.altitudeM, 0)}`,
              })}
            </span>
            <button
              onClick={() => {
                onChange({ atmosphereLevels: undefined });
                onCommit?.();
              }}
              className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-300 ring-1 ring-white/10 hover:bg-slate-700"
            >
              {t('launch.clearForecastProfile')}
            </button>
          </div>
        )}
        {weatherKey && <WeatherKeyField />}
      </CardGroup>

      <CardGroup title={t('launch.wind')}>
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
                // Cleared is CLEARED, not 0: 0 is a real wind speed, so
                // landing there makes emptying the field assert still air.
                if (v == null) return onChange({ windAverage: null });
                // OpenRocket holds the turbulence INTENSITY constant when the
                // average moves (`PinkNoiseWindModel.setAverage`), so wind that
                // was 15% gusty stays 15% gusty instead of quietly becoming 5%
                // because the wind picked up. Skipped from a zero average,
                // where the ratio is the 0-or-1 stand-in rather than a real
                // fraction and rescaling would snap the scatter to the whole
                // wind speed.
                if (!hasIntensity(windAvg)) return onChange({ windAverage: v });
                onChange({ windAverage: v, windStdDev: retuneStdDev(windAvg, windSd, v) });
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
              maxSi={MAX_WIND_SPEED_MS}
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
            <NumberRow
              label={t('launch.turbulenceIntensity')}
              unit="%"
              step={1}
              min={0}
              max={MAX_TURBULENCE_PERCENT}
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
              value={launch.windDirectionDeg ?? DEFAULT_HEADING_DEG}
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
      </CardGroup>

      <CardGroup title={t('launch.earthModel')}>
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
      </CardGroup>

      {weatherOpen && (
        <WeatherDialog
          launch={launch}
          onChange={onChange}
          onCommit={onCommit}
          onClose={() => setWeatherOpen(false)}
          refresh={weatherRefresh}
        />
      )}
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
