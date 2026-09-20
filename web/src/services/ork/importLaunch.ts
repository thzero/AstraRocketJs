import type { LaunchConditions } from '../orkTree';
import { xmlText as text } from '../xmlUtil';
import { stdDevForIntensity } from '../windTurbulence';
import { finiteNum } from './numbers';
import { numTag } from './importTags';

/**
 * Launch conditions from the FIRST <simulation>'s <conditions> (the desktop
 * saves one block per simulation; the app has a single launch panel). Units
 * per the desktop OpenRocketSaver: rod angle in DEGREES, wind speeds m/s,
 * altitude m, temperature KELVIN, pressure PASCAL. <wind model="average"> is
 * the modern form; the bare windaverage/windturbulence pair — turbulence
 * stored as the INTENSITY ratio stddev/average — is the ≤23.09 legacy form
 * the desktop still writes alongside it.
 */
export function readLaunchConditions(doc: Document): Partial<LaunchConditions> | undefined {
  const simEl = doc.querySelector('openrocket > simulations > simulation');
  const condEl = simEl?.querySelector(':scope > conditions');
  if (!condEl) return undefined;
  const launch: Partial<LaunchConditions> = {};

  const rodLen = numTag(condEl, 'launchrodlength', NaN);
  if (!Number.isNaN(rodLen)) launch.launchRodLengthM = rodLen;
  const rodAngle = numTag(condEl, 'launchrodangle', NaN);
  if (!Number.isNaN(rodAngle)) launch.launchRodAngleDeg = rodAngle;
  // Rod heading is DEGREES on disk like the rod angle (OpenRocketSaver.java:
  // launchroddirection is written as radians * 360 / 2pi). The app edits all
  // three of these, and the writer used to emit constants for them, so a
  // launch set up on the desktop came back pointing at the default heading.
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

  const gravity = (text(condEl, ':scope > gravitymodel') ?? '').trim().toLowerCase();
  if (gravity === 'constant') {
    launch.gravityModel = 'constant';
    const g = numTag(condEl, 'constantgravity', NaN);
    if (!Number.isNaN(g)) launch.constantGravity = g;
  } else if (gravity === 'wgs') {
    launch.gravityModel = 'wgs';
  }

  const gm = (text(condEl, ':scope > geodeticmethod') ?? '').toLowerCase();
  if (gm) launch.geodetic = gm === 'flat' ? 'flat' : gm === 'wgs84' ? 'wgs84' : 'spherical';

  return Object.keys(launch).length > 0 ? launch : undefined;
}

function readWind(condEl: Element, launch: Partial<LaunchConditions>): void {
  const windEls = Array.from(condEl.querySelectorAll(':scope > wind'));
  const windModelType = (text(condEl, ':scope > windmodeltype') ?? '').toLowerCase();

  // Average wind: modern <wind model="average"> (speed/direction/standarddeviation)
  // or the ≤23.09 legacy <windaverage>/<windturbulence>/<winddirection> trio.
  const avgEl = windEls.find((w) => w.getAttribute('model') === 'average');
  let avg = avgEl ? numTag(avgEl, 'speed', NaN) : NaN;
  if (Number.isNaN(avg)) avg = numTag(condEl, 'windaverage', NaN);
  if (!Number.isNaN(avg)) launch.windAverage = avg;
  let sd = avgEl ? numTag(avgEl, 'standarddeviation', NaN) : NaN;
  if (Number.isNaN(sd)) {
    const turb = numTag(condEl, 'windturbulence', NaN);
    if (!Number.isNaN(turb) && !Number.isNaN(avg)) sd = stdDevForIntensity(avg, turb);
  }
  if (!Number.isNaN(sd)) launch.windStdDev = sd;
  let dirRad = avgEl ? numTag(avgEl, 'direction', NaN) : NaN;
  if (Number.isNaN(dirRad)) dirRad = numTag(condEl, 'winddirection', NaN);
  if (!Number.isNaN(dirRad)) launch.windDirectionDeg = (dirRad * 180) / Math.PI;

  // Multilevel wind (24.x): <wind model="multilevel"><windlevel altitude speed
  // direction standarddeviation/>…>. Honored when windmodeltype selects it.
  const mlEl = windEls.find((w) => (w.getAttribute('model') ?? '').toLowerCase() === 'multilevel');
  if (mlEl && windModelType.includes('multilevel')) {
    // finiteNum, not `parseFloat(x) || 0`: that let "Infinity" through as a
    // wind speed, and the kernel's wind model has no answer for it.
    const levels = Array.from(mlEl.querySelectorAll(':scope > windlevel')).map((w) => ({
      altitudeM: finiteNum(w.getAttribute('altitude')) ?? 0,
      speed: finiteNum(w.getAttribute('speed')) ?? 0,
      directionDeg: ((finiteNum(w.getAttribute('direction')) ?? 0) * 180) / Math.PI,
      stddev: finiteNum(w.getAttribute('standarddeviation')) ?? 0,
    }));
    if (levels.length) launch.windLevels = levels;
    // MSL unless the file says AGL. The desktop carries it as an ATTRIBUTE on
    // the <wind> element (OpenRocketSaver.java:367 writes
    // <wind model="multilevel" altituderef="AGL">, importt/WindHandler.java:25
    // reads attributes.get("altituderef")). This reader used to look for a
    // child element or an attribute of a different name, so every AGL profile
    // the desktop saved came in as MSL. The other spellings stay accepted for
    // the files this app wrote before it matched the desktop.
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
  // A FRACTION on disk, as the kernel holds it. Read from either place: we
  // write it inside <atmosphere>, and a desktop that carries it alongside the
  // other launch fields puts it on <conditions>.
  const rh = numTag(atmEl, 'relativehumidity', numTag(condEl, 'launchrelativehumidity', NaN));
  if (!Number.isNaN(rh)) launch.relativeHumidity = rh;
}
