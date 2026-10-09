import type { LaunchConditions } from '../../design/orkTree';
import { xmlText as text } from '../xmlUtil';
import { stdDevForIntensity } from '../../flight/windTurbulence';
import { usableWindLevels } from '../../flight/windLevels';
import { usableAtmosphereLevels } from '../../flight/atmosphereLevels';
import { isWeatherSource, restoredSource } from '../../weather/weatherSource';
import { finiteNum } from './numbers';
import { numTag } from './importTags';
import { radToDeg } from '../../../prefs/units';

/**
 * Launch conditions from the first <simulation>'s <conditions> (the desktop
 * saves one block per simulation; the app has a single launch panel). Units
 * per the desktop OpenRocketSaver: rod angle in degrees, wind speeds m/s,
 * altitude m, temperature kelvin, pressure pascal. <wind model="average"> is
 * the modern form; the bare windaverage/windturbulence pair (turbulence
 * stored as the intensity ratio stddev/average) is the ≤23.09 legacy form
 * the desktop still writes alongside it.
 */
export function readLaunchConditions(doc: Document): Partial<LaunchConditions> | undefined {
  return readSimulationLaunch(doc.querySelector('openrocket > simulations > simulation'));
}

/** The same, from one given <simulation> element (see ork/importSimulations). */
export function readSimulationLaunch(simEl: Element | null): Partial<LaunchConditions> | undefined {
  const condEl = simEl?.querySelector(':scope > conditions');
  if (!condEl) return undefined;
  const launch: Partial<LaunchConditions> = {};

  const rodLen = numTag(condEl, 'launchrodlength', NaN);
  if (!Number.isNaN(rodLen)) launch.launchRodLengthM = rodLen;
  const rodAngle = numTag(condEl, 'launchrodangle', NaN);
  if (!Number.isNaN(rodAngle)) launch.launchRodAngleDeg = rodAngle;
  // Rod heading is degrees on disk like the rod angle (OpenRocketSaver:
  // launchroddirection is written as radians * 360 / 2pi). The app edits all
  // three of these, so they are read from the file rather than defaulted, or a
  // launch set up on the desktop comes back pointing at the default heading.
  const rodDir = numTag(condEl, 'launchroddirection', NaN);
  if (!Number.isNaN(rodDir)) launch.launchRodDirectionDeg = rodDir;
  const intoWind = (text(condEl, ':scope > launchintowind') ?? '').trim().toLowerCase();
  if (intoWind === 'true' || intoWind === 'false') launch.launchIntoWind = intoWind === 'true';

  readWind(condEl, launch);

  const alt = numTag(condEl, 'launchaltitude', NaN);
  if (!Number.isNaN(alt)) launch.launchAltitudeM = alt;
  const lat = numTag(condEl, 'launchlatitude', NaN);
  if (!Number.isNaN(lat)) launch.latitudeDeg = lat;
  const lon = numTag(condEl, 'launchlongitude', NaN);
  if (!Number.isNaN(lon)) launch.longitudeDeg = lon;

  readAtmosphere(condEl, launch);

  readGravity(condEl, launch);

  const gm = (text(condEl, ':scope > geodeticmethod') ?? '').toLowerCase();
  if (gm) launch.geodetic = gm === 'flat' ? 'flat' : gm === 'wgs84' ? 'wgs84' : 'spherical';
  readWeatherSource(condEl, launch);

  return Object.keys(launch).length > 0 ? launch : undefined;
}

/**
 * The gravity model, as the desktop's GravityHandler reads it:
 * `<gravity model="wgs|constant">` with the constant in `<value>`. The bare
 * `<gravitymodel>`/`<constantgravity>` pair is read when no `<gravity>` is
 * present, for files written in that spelling.
 */
function readGravity(condEl: Element, launch: Partial<LaunchConditions>): void {
  const el = condEl.querySelector(':scope > gravity');
  if (el) {
    const model = (el.getAttribute('model') ?? '').trim().toLowerCase();
    if (model === 'constant') {
      launch.gravityModel = 'constant';
      const g = numTag(el, 'value', NaN);
      if (!Number.isNaN(g)) launch.constantGravity = g;
    } else {
      // Desktop falls back to WGS for an unknown model.
      launch.gravityModel = 'wgs';
    }
    return;
  }
  const gravity = (text(condEl, ':scope > gravitymodel') ?? '').trim().toLowerCase();
  if (gravity === 'constant') {
    launch.gravityModel = 'constant';
    const g = numTag(condEl, 'constantgravity', NaN);
    if (!Number.isNaN(g)) launch.constantGravity = g;
  } else if (gravity === 'wgs') {
    launch.gravityModel = 'wgs';
  }
}

/** This app's Weather stamp (see exportSimulation); one that does not read whole is dropped. */
function readWeatherSource(condEl: Element, launch: Partial<LaunchConditions>): void {
  const el = condEl.querySelector(':scope > weathersource');
  if (!el) return;
  const a = (k: string) => el.getAttribute(k) ?? '';
  const num = (k: string) => (a(k).trim() === '' ? NaN : Number(a(k)));
  const source = {
    provider: a('provider'),
    endpoint: a('endpoint'),
    date: a('date'),
    hour: num('hour'),
    timezone: a('timezone'),
    latitudeDeg: num('latitude'),
    longitudeDeg: num('longitude'),
    elevationM: num('elevation'),
    validAt: a('valid'),
    fetchedAt: a('fetched'),
    groups: a('groups').split(/\s+/).filter(Boolean),
    elevationApplied: a('elevationapplied') === 'true',
    ...(a('edited') === 'true' ? { edited: true as const } : {}),
  };
  if (isWeatherSource(source)) launch.weatherSource = restoredSource(source, launch as LaunchConditions);
}

function readWind(condEl: Element, launch: Partial<LaunchConditions>): void {
  const windEls = Array.from(condEl.querySelectorAll(':scope > wind'));
  const windModelType = (text(condEl, ':scope > windmodeltype') ?? '').toLowerCase();

  // Average wind: modern <wind model="average"> (speed/direction/standarddeviation)
  // or the ≤23.09 legacy <windaverage>/<windturbulence>/<winddirection> trio.
  const avgEl = windEls.find((w) => w.getAttribute('model') === 'average');
  let avg = avgEl ? numTag(avgEl, 'speed', NaN) : NaN;
  if (Number.isNaN(avg)) avg = numTag(condEl, 'windaverage', NaN);
  // The bridge sets the heading after the speed, so a negative average flies
  // at its magnitude from the stated heading; stored that way, the field shows
  // the wind that flies.
  if (!Number.isNaN(avg)) launch.windAverage = Math.abs(avg);
  let sd = avgEl ? numTag(avgEl, 'standarddeviation', NaN) : NaN;
  if (Number.isNaN(sd)) {
    const turb = numTag(condEl, 'windturbulence', NaN);
    if (!Number.isNaN(turb) && !Number.isNaN(avg)) sd = stdDevForIntensity(avg, turb);
  }
  if (!Number.isNaN(sd)) launch.windStdDev = sd;
  let dirRad = avgEl ? numTag(avgEl, 'direction', NaN) : NaN;
  if (Number.isNaN(dirRad)) dirRad = numTag(condEl, 'winddirection', NaN);
  if (!Number.isNaN(dirRad)) launch.windDirectionDeg = radToDeg(dirRad);

  // Multilevel wind (24.x): <wind model="multilevel"><windlevel altitude speed
  // direction standarddeviation/>…>. Honored when windmodeltype selects it.
  const mlEl = windEls.find((w) => (w.getAttribute('model') ?? '').toLowerCase() === 'multilevel');
  if (mlEl && windModelType.includes('multilevel')) {
    // finiteNum, not `parseFloat(x) || 0`: that would let "Infinity" through
    // as a wind speed, and the kernel's wind model has no answer for it.
    //
    // The altitude has no `?? 0`, unlike the other three: it is the level's
    // identity to the kernel, which keys its levels on it. Defaulted to 0 m, a
    // file that omits or garbles one imports as a second surface level, which
    // either displaces the real surface wind or collides with it and fails every
    // run with `Wind level already exists for altitude: 0.0`. `usableWindLevels`
    // drops it, and drops a file's own repeated altitude the same way.
    const levels = usableWindLevels(
      Array.from(mlEl.querySelectorAll(':scope > windlevel')).map((w) => {
        // A negative speed is a wind from the opposite heading, as
        // MultiLevelPinkNoiseWindModel.addWindLevel flies it.
        const speed = finiteNum(w.getAttribute('speed')) ?? 0;
        const deg = ((finiteNum(w.getAttribute('direction')) ?? 0) * 180) / Math.PI;
        return {
          altitudeM: finiteNum(w.getAttribute('altitude')),
          speed: Math.abs(speed),
          directionDeg: speed < 0 ? (((deg + 180) % 360) + 360) % 360 : deg,
          stddev: finiteNum(w.getAttribute('standarddeviation')) ?? 0,
        };
      }),
    );
    if (levels.length) launch.windLevels = levels;
    // MSL unless the file says AGL. The desktop carries it as an attribute on
    // the <wind> element (OpenRocketSaver writes
    // <wind model="multilevel" altituderef="AGL">, importt/WindHandler
    // reads attributes.get("altituderef")), so that is what is read here, or
    // every AGL profile the desktop saves comes in as MSL. The other spellings
    // stay accepted for files older builds of this app wrote.
    const ref = (
      mlEl.getAttribute('altituderef') ??
      text(mlEl, ':scope > altitudereference') ??
      mlEl.getAttribute('altitudereference') ??
      ''
    )
      .trim()
      .toLowerCase();
    if (ref === 'agl' || ref === 'msl') launch.windAltitudeReference = ref;
  }
}

function readAtmosphere(condEl: Element, launch: Partial<LaunchConditions>): void {
  const atmEl = condEl.querySelector(':scope > atmosphere');
  if (!atmEl) return;
  if (atmEl.getAttribute('model') === 'isa') {
    // ISA standard: null means "blank = standard" in LaunchConditions.
    launch.temperatureC = null;
    launch.pressureHPa = null;
  } else {
    const tK = numTag(atmEl, 'basetemperature', NaN);
    if (!Number.isNaN(tK)) launch.temperatureC = tK - 273.15;
    const pPa = numTag(atmEl, 'basepressure', NaN);
    if (!Number.isNaN(pPa)) launch.pressureHPa = pPa / 100;
  }
  // A fraction on disk, as the kernel holds it. <baserelativehumidity> is
  // desktop's element and what this app writes; <relativehumidity> (an older
  // spelling this app wrote) and <launchrelativehumidity> on <conditions> are
  // read too.
  const rh = numTag(
    atmEl,
    'baserelativehumidity',
    numTag(atmEl, 'relativehumidity', numTag(condEl, 'launchrelativehumidity', NaN)),
  );
  if (!Number.isNaN(rh)) launch.relativeHumidity = rh;
  // This app's forecast atmosphere (see exportSimulation). Kelvin and pascal on
  // disk; a level the engine would refuse is dropped rather than failing the run.
  const levels = usableAtmosphereLevels(
    Array.from(atmEl.querySelectorAll(':scope > forecastlevel')).map((l) => {
      // An absent attribute is NaN, not the 0 Number(null) would make of it.
      const at = (name: string) => {
        const v = l.getAttribute(name);
        return v === null || v.trim() === '' ? NaN : Number(v);
      };
      return {
        altitudeM: at('altitude'),
        temperatureC: at('temperature') - 273.15,
        pressureHPa: at('pressure') / 100,
        relativeHumidity: at('relativehumidity'),
      };
    }),
  );
  if (levels.length) launch.atmosphereLevels = levels;
}
