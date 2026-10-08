import type { AtmosphereLevel, LaunchConditions } from '../../design/orkTree';
import { escapeXml } from '../xmlUtil';
import { isWeatherSource, sourceStatus } from '../../weather/weatherSource';
import { turbulenceIntensity } from '../../flight/windTurbulence';
import type { OrkWriter } from './exportWriter';
import type { FlightSummary } from '../../../engine/openRocketEngine';
import type { OrkExportSimulation } from '../orkTypes';
import { degToRad } from '../../../prefs/units';
import { DEFAULT_HEADING_DEG } from '../../flight/simulations';
import { G0 } from '../../motors/motorMath';

/**
 * The <simulations> block: every simulation, each with its own conditions and
 * result summary, when the caller passes them; else one <simulation> carrying
 * the launch panel's conditions; else the empty wrapper.
 */
export function simulationsXml(
  w: OrkWriter,
  depth: number,
  launch: LaunchConditions | undefined,
  simulations?: readonly OrkExportSimulation[],
): void {
  const { emit } = w;
  emit(depth, '<simulations>');
  if (simulations?.length) {
    for (const sim of simulations) simulationXml(w, depth + 1, sim);
  } else if (launch) {
    // One <simulation> in the exact shape of the desktop's
    // OpenRocketSaver.saveSimulation() so 24.12 opens it cleanly. Its loader
    // tolerates missing elements but WARNS on any simulator/calculator other
    // than RK4Simulator/BarrowmanCalculator and on unknown status values —
    // write the only ones it accepts. <configid> ties the simulation to the
    // default-marked motorconfiguration emitted above.
    emit(depth + 1, '<simulation status="notsimulated">');
    emit(depth + 2, '<name>Simulation 1</name>');
    emit(depth + 2, '<simulator>RK4Simulator</simulator>');
    emit(depth + 2, '<calculator>BarrowmanCalculator</calculator>');
    emit(depth + 2, '<conditions>');
    conditionsXml(w, depth + 3, launch);
    emit(depth + 2, '</conditions>');
    emit(depth + 1, '</simulation>');
  }
  emit(depth, '</simulations>');
}

/**
 * One simulation, in the shape of the desktop's OpenRocketSaver.saveSimulation():
 * status, name, simulator, calculator, conditions, then the <flightdata> summary
 * when there is a result. The summary is the ten figures as attributes; the
 * per-sample <databranch> data is not written, so the desktop shows the figures
 * and re-flies the simulation for its plots.
 */
function simulationXml(w: OrkWriter, depth: number, sim: OrkExportSimulation): void {
  const { emit } = w;
  const summary = sim.status === 'notsimulated' ? undefined : sim.summary;
  emit(depth, `<simulation status="${summary ? sim.status : 'notsimulated'}">`);
  emit(depth + 1, `<name>${escapeXml(sim.name)}</name>`);
  emit(depth + 1, '<simulator>RK4Simulator</simulator>');
  emit(depth + 1, '<calculator>BarrowmanCalculator</calculator>');
  emit(depth + 1, '<conditions>');
  const configId = w.writeConfigs.some((c) => c.id === sim.configId) ? sim.configId : w.defaultId;
  conditionsXml(w, depth + 2, sim.launch, configId);
  emit(depth + 1, '</conditions>');
  if (summary) emit(depth + 1, flightDataTag(summary));
  emit(depth, '</simulation>');
}

/** The <flightdata> summary as the desktop writes it: one attribute per figure it has. */
function flightDataTag(s: FlightSummary): string {
  const attrs: [string, number | null][] = [
    ['maxaltitude', s.maxAltitude],
    ['maxvelocity', s.maxVelocity],
    ['maxacceleration', s.maxAcceleration],
    ['maxmach', s.maxMachNumber],
    ['timetoapogee', s.timeToApogee],
    ['flighttime', s.flightTime],
    ['groundhitvelocity', s.groundHitVelocity],
    ['launchrodvelocity', s.launchRodVelocity],
    ['deploymentvelocity', s.deploymentVelocity],
    ['optimumdelay', s.optimumDelay],
  ];
  const written = attrs
    .filter(([, v]) => v != null && Number.isFinite(v))
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  return `<flightdata${written}/>`;
}

function conditionsXml(w: OrkWriter, depth: number, launch: LaunchConditions, configId: string = w.defaultId): void {
  const { emit } = w;
  emit(depth, `<configid>${escapeXml(configId)}</configid>`);
  emit(depth, `<launchrodlength>${launch.launchRodLengthM ?? 0}</launchrodlength>`);
  // The app edits launch-into-wind, the rod heading, the wind heading and the
  // longitude (LaunchPanel), so all four are written from the design rather than
  // from the desktop's preference defaults. Units per OpenRocketSaver.java:
  // 349-354: the rod heading is DEGREES on disk (written as radians * 360 / 2pi,
  // like the rod angle); the wind heading is RADIANS (getDirection() written
  // raw). The fallbacks are the desktop's own defaults, used only when the field
  // was never set.
  emit(depth, `<launchintowind>${launch.launchIntoWind === true}</launchintowind>`);
  emit(depth, `<launchrodangle>${launch.launchRodAngleDeg ?? 0}</launchrodangle>`);
  emit(depth, `<launchroddirection>${launch.launchRodDirectionDeg ?? DEFAULT_HEADING_DEG}</launchroddirection>`);
  windXml(w, depth, launch);
  emit(depth, `<launchaltitude>${launch.launchAltitudeM ?? 0}</launchaltitude>`);
  emit(depth, `<launchlatitude>${launch.latitudeDeg ?? 0}</launchlatitude>`);
  // Degrees; the desktop's preference default when the site was never set.
  emit(depth, `<launchlongitude>${launch.longitudeDeg ?? -80.6}</launchlongitude>`);
  emit(depth, `<geodeticmethod>${launch.geodetic ?? 'spherical'}</geodeticmethod>`);
  // Gravity: only written when it is NOT the default, so a file that never
  // touched it round-trips unchanged.
  if (launch.gravityModel === 'constant') {
    emit(depth, '<gravitymodel>Constant</gravitymodel>');
    emit(depth, `<constantgravity>${launch.constantGravity ?? G0}</constantgravity>`);
  }
  atmosphereXml(w, depth, launch);
  weatherSourceXml(w, depth, launch);
  // RK4SimulationStepper recommended defaults (the desktop's own values).
  emit(depth, '<timestep>0.05</timestep>');
  emit(depth, '<maxtime>1200.0</maxtime>');
}

function windXml(w: OrkWriter, depth: number, launch: LaunchConditions): void {
  const { emit } = w;
  const windDirRad = degToRad(launch.windDirectionDeg ?? DEFAULT_HEADING_DEG);
  // ≤23.09 legacy trio the desktop still writes: turbulence here is the
  // INTENSITY ratio stddev/average, which is why it goes through the same
  // helper the panel reads from (zero wind maps to 0 or 1, as the kernel's
  // PinkNoiseWindModel does, so old desktops recover the same stddev).
  // A design can be SAVED mid-edit, with a required field still blank, even
  // though it cannot be flown. The file format has no way to say "blank", so
  // a hole is written as zero here rather than blocking the save.
  const turb = turbulenceIntensity(launch.windAverage ?? 0, launch.windStdDev ?? 0);
  emit(depth, `<windaverage>${launch.windAverage ?? 0}</windaverage>`);
  emit(depth, `<windturbulence>${turb}</windturbulence>`);
  emit(depth, `<winddirection>${windDirRad}</winddirection>`);
  emit(depth, '<wind model="average">');
  emit(depth + 1, `<speed>${launch.windAverage ?? 0}</speed>`);
  emit(depth + 1, `<direction>${windDirRad}</direction>`);
  emit(depth + 1, `<standarddeviation>${launch.windStdDev ?? 0}</standarddeviation>`);
  emit(depth, '</wind>');
  // The multilevel profile, when there is one. The desktop writes BOTH wind
  // elements and lets <windmodeltype> pick, which is also what our importer
  // reads, so the average block above stays as the fallback a reader without
  // multilevel support sees. Without this the profile imported fine and then
  // vanished on the way back out.
  const levels = launch.windLevels ?? [];
  if (levels.length) {
    // The altitude reference is an ATTRIBUTE of <wind>, exactly as
    // OpenRocketSaver.java:367 writes it and importt/WindHandler.java:25 reads
    // it. As a child element the desktop never looks at it, so an AGL profile
    // saved here would open there as MSL.
    emit(depth, `<wind model="multilevel" altituderef="${(launch.windAltitudeReference ?? 'msl').toUpperCase()}">`);
    for (const l of levels) {
      // Attributes, not child elements, and direction in RADIANS like the
      // average block's <direction>.
      emit(
        depth + 1,
        `<windlevel altitude="${l.altitudeM}" speed="${l.speed}" direction="${degToRad(l.directionDeg)}" standarddeviation="${l.stddev}"/>`,
      );
    }
    emit(depth, '</wind>');
  }
  emit(depth, `<windmodeltype>${levels.length ? 'Multilevel' : 'Average'}</windmodeltype>`);
}

function atmosphereXml(w: OrkWriter, depth: number, launch: LaunchConditions): void {
  const { emit } = w;
  const levels = launch.atmosphereLevels ?? [];
  if (launch.temperatureC === null && launch.pressureHPa === null && launch.relativeHumidity == null) {
    if (!levels.length) emit(depth, '<atmosphere model="isa"/>');
    else {
      emit(depth, '<atmosphere model="isa">');
      forecastLevelsXml(w, depth + 1, levels);
      emit(depth, '</atmosphere>');
    }
  } else {
    // KELVIN / PASCAL on disk. The desktop stores both-or-ISA, so a
    // single custom value fills the other with the ISA sea-level standard.
    emit(depth, '<atmosphere model="extendedisa">');
    emit(depth + 1, `<basetemperature>${(launch.temperatureC ?? 15) + 273.15}</basetemperature>`);
    emit(depth + 1, `<basepressure>${(launch.pressureHPa ?? 1013.25) * 100}</basepressure>`);
    // Only when set, so a file that never expressed humidity carries none.
    // <baserelativehumidity> is the element desktop writes and reads
    // (OpenRocketSaver, AtmosphereHandler); under any other name it skips it.
    if (launch.relativeHumidity != null) {
      emit(depth + 1, `<baserelativehumidity>${launch.relativeHumidity}</baserelativehumidity>`);
    }
    forecastLevelsXml(w, depth + 1, levels);
    emit(depth, '</atmosphere>');
  }
}

/**
 * Where the weather-filled fields came from (the Weather dialog's stamp), as an
 * extension element desktop OpenRocket skips. Whether they were edited since is
 * decided now and written as `edited`, so the file needs no copy of the
 * applied values.
 */
function weatherSourceXml(w: OrkWriter, depth: number, launch: LaunchConditions): void {
  const s = launch.weatherSource;
  if (!isWeatherSource(s)) return;
  const edited = sourceStatus(launch, Date.now())?.edited === true;
  const attr = (k: string, v: string | number | boolean) => `${k}="${escapeXml(String(v))}"`;
  w.emit(
    depth,
    `<weathersource ${[
      attr('provider', s.provider),
      attr('endpoint', s.endpoint),
      attr('date', s.date),
      attr('hour', s.hour),
      attr('timezone', s.timezone),
      attr('latitude', s.latitudeDeg),
      attr('longitude', s.longitudeDeg),
      attr('elevation', s.elevationM),
      attr('valid', s.validAt),
      attr('fetched', s.fetchedAt),
      attr('groups', s.groups.join(' ')),
      attr('elevationapplied', s.elevationApplied),
      attr('edited', edited),
    ].join(' ')}/>`,
  );
}

/**
 * A forecast atmosphere, as an extension element of this app's: desktop
 * OpenRocket has no such model and skips elements it does not know, so a
 * desktop opening the file flies its own atmosphere. KELVIN and PASCAL, like
 * <basetemperature> and <basepressure> beside it.
 */
function forecastLevelsXml(w: OrkWriter, depth: number, levels: readonly AtmosphereLevel[]): void {
  for (const l of levels) {
    w.emit(
      depth,
      `<forecastlevel altitude="${l.altitudeM}" temperature="${l.temperatureC + 273.15}" pressure="${l.pressureHPa * 100}" relativehumidity="${l.relativeHumidity}"/>`,
    );
  }
}
