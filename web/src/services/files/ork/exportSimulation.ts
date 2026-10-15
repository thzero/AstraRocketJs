// cspell:ignore randomseed recoveryspeedwarning droguelowspeedwarning Lowspeedwarning recoverydroguemainhighspeedwarning recoverydroguemainlowspeedwarning -- OpenRocket .ork element names
import type { AtmosphereLevel, LaunchConditions } from '../../design/orkTree';
import { escapeXml } from '../xmlUtil';
import { isWeatherSource, sourceStatus } from '../../weather/weatherSource';
import { turbulenceIntensity } from '../../flight/windTurbulence';
import type { OrkWriter } from './exportWriter';
import type { FlightSummary } from '../../../engine/openRocketEngine';
import type { OrkExportSimulation, OrkSimPrefs } from '../orkTypes';
import { unwrapConditionsChild } from './passthrough';
import { degToRad } from '../../../prefs/units';
import { DEFAULT_HEADING_DEG } from '../../flight/simulations';
import { G0 } from '../../motors/motorMath';
import { DEFAULT_SETTINGS } from '../../storage/settings';

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
  prefs: OrkSimPrefs = DESKTOP_SIM_PREFS,
): void {
  const { emit } = w;
  emit(depth, '<simulations>');
  if (simulations?.length) {
    for (const sim of simulations) simulationXml(w, depth + 1, sim, prefs);
  } else if (launch) {
    // One <simulation> in the exact shape of the desktop's
    // OpenRocketSaver.saveSimulation() so 24.12 opens it cleanly. Its loader
    // tolerates missing elements but warns on any simulator/calculator other
    // than RK4Simulator/BarrowmanCalculator and on unknown status values, so
    // this writes the only ones it accepts. <configid> ties the simulation to the
    // default-marked motorconfiguration emitted above.
    emit(depth + 1, '<simulation status="notsimulated">');
    emit(depth + 2, '<name>Simulation 1</name>');
    emit(depth + 2, '<simulator>RK4Simulator</simulator>');
    emit(depth + 2, '<calculator>BarrowmanCalculator</calculator>');
    emit(depth + 2, '<conditions>');
    conditionsXml(w, depth + 3, launch, prefs, []);
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
function simulationXml(w: OrkWriter, depth: number, sim: OrkExportSimulation, prefs: OrkSimPrefs): void {
  const { emit } = w;
  // Carried conditions children go back inside the conditions; the rest of
  // the carried children follow them.
  const carriedConditions: string[] = [];
  const carried: string[] = [];
  for (const raw of sim.xmlExtra ?? []) {
    const child = unwrapConditionsChild(raw);
    if (child === null) carried.push(raw);
    else carriedConditions.push(child);
  }
  const summary = sim.status === 'notsimulated' ? undefined : sim.summary;
  emit(depth, `<simulation status="${summary ? sim.status : 'notsimulated'}">`);
  emit(depth + 1, `<name>${escapeXml(sim.name)}</name>`);
  emit(depth + 1, '<simulator>RK4Simulator</simulator>');
  emit(depth + 1, '<calculator>BarrowmanCalculator</calculator>');
  emit(depth + 1, '<conditions>');
  const configId = w.writeConfigs.some((c) => c.id === sim.configId) ? sim.configId : w.defaultId;
  // Each simulation's own: desktop keeps a time step and warning thresholds per
  // simulation and reads them into that simulation's options.
  conditionsXml(w, depth + 2, sim.launch, sim.prefs ?? prefs, carriedConditions, configId);
  emit(depth + 1, '</conditions>');
  // What the file carried that this app does not model, where desktop writes it.
  for (const raw of carried) emit(depth + 1, raw);
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

/**
 * The desktop's own defaults for what `OrkSimPrefs` covers (SimulationOptions
 * and the RK4 stepper's recommended step), for a caller that passes none. The
 * app's default settings are those numbers, so they are read from there rather
 * than held a second time.
 */
const DESKTOP_SIM_PREFS: OrkSimPrefs = DEFAULT_SETTINGS.simulation;

function conditionsXml(
  w: OrkWriter,
  depth: number,
  launch: LaunchConditions,
  prefs: OrkSimPrefs,
  carried: readonly string[],
  configId: string = w.defaultId,
): void {
  const { emit } = w;
  emit(depth, `<configid>${escapeXml(configId)}</configid>`);
  emit(depth, `<launchrodlength>${launch.launchRodLengthM ?? 0}</launchrodlength>`);
  // The app edits launch-into-wind, the rod heading, the wind heading and the
  // longitude (LaunchPanel), so all four are written from the design rather than
  // from the desktop's preference defaults. Units per OpenRocketSaver: the rod
  // heading is degrees on disk (written as radians * 360 / 2pi, like the rod
  // angle); the wind heading is radians (getDirection() written raw). The
  // fallbacks are the desktop's own defaults, used only when the field was
  // never set.
  emit(depth, `<launchintowind>${launch.launchIntoWind === true}</launchintowind>`);
  emit(depth, `<launchrodangle>${launch.launchRodAngleDeg ?? 0}</launchrodangle>`);
  emit(depth, `<launchroddirection>${launch.launchRodDirectionDeg ?? DEFAULT_HEADING_DEG}</launchroddirection>`);
  windXml(w, depth, launch);
  emit(depth, `<launchaltitude>${launch.launchAltitudeM ?? 0}</launchaltitude>`);
  emit(depth, `<launchlatitude>${launch.latitudeDeg ?? 0}</launchlatitude>`);
  // Degrees; the desktop's preference default when the site was never set.
  emit(depth, `<launchlongitude>${launch.longitudeDeg ?? -80.6}</launchlongitude>`);
  emit(depth, `<geodeticmethod>${launch.geodetic ?? 'spherical'}</geodeticmethod>`);
  // A fixed seed is written as the desktop writes one; with none, the file's
  // own seed (carried below) is what stands, since a run here drew a fresh one.
  const seed = prefs.randomSeed;
  const fixedSeed = seed != null && Number.isInteger(seed);
  if (fixedSeed) emit(depth, `<randomseed>${seed}</randomseed>`);
  atmosphereXml(w, depth, launch);
  forecastLevelsXml(w, depth, launch.atmosphereLevels ?? []);
  // Gravity as the bare <gravitymodel>/<constantgravity> pair, which this app
  // reads and every OpenRocket skips without a warning: SimulationConditionsHandler
  // ignores a <conditions> child it does not know. Upstream's own
  // <gravity model="constant"><value> is not written: 24.12 has no gravity
  // setting, warns on the <value> child and then misreads the rest of the
  // simulations block. Desktop flies its own gravity either way. Only written
  // when it is not the default, so a file that never touched it round-trips
  // unchanged.
  if (launch.gravityModel === 'constant') {
    emit(depth, '<gravitymodel>constant</gravitymodel>');
    emit(depth, `<constantgravity>${launch.constantGravity ?? G0}</constantgravity>`);
  }
  weatherSourceXml(w, depth, launch);
  // What the run flew under, in upstream OpenRocketSaver's elements and order.
  // 24.12 reads the time step and the maximum time and skips the four warning
  // thresholds without a warning. The drogue element's capital L is upstream's
  // own spelling, which its reader matches exactly.
  emit(depth, `<timestep>${prefs.timeStep}</timestep>`);
  emit(depth, `<maxtime>${prefs.maxTime}</maxtime>`);
  emit(depth, `<recoveryspeedwarning>${prefs.deploymentSpeedWarn}</recoveryspeedwarning>`);
  emit(depth, `<drogueLowspeedwarning>${prefs.drogueLowSpeedWarn}</drogueLowspeedwarning>`);
  emit(depth, `<recoverydroguemainhighspeedwarning>${prefs.mainHighSpeedWarn}</recoverydroguemainhighspeedwarning>`);
  emit(depth, `<recoverydroguemainlowspeedwarning>${prefs.mainLowSpeedWarn}</recoverydroguemainlowspeedwarning>`);
  // The file's own children this app does not model, the seed among them
  // unless one was written above.
  for (const raw of carried) {
    if (fixedSeed && /^<randomseed[\s>/]/i.test(raw)) continue;
    emit(depth, raw);
  }
}

function windXml(w: OrkWriter, depth: number, launch: LaunchConditions): void {
  const { emit } = w;
  const windDirRad = degToRad(launch.windDirectionDeg ?? DEFAULT_HEADING_DEG);
  // ≤23.09 legacy trio the desktop still writes: turbulence here is the
  // intensity ratio stddev/average, which is why it goes through the same
  // helper the panel reads from (zero wind maps to 0 or 1, as the kernel's
  // PinkNoiseWindModel does, so old desktops recover the same stddev).
  // A design can be saved mid-edit, with a required field still blank, even
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
  // The multilevel profile, when there is one, flown or kept. The desktop
  // writes both wind elements and lets <windmodeltype> pick, which is also what
  // our importer reads, so the average block above stays as the fallback a
  // reader without multilevel support sees, and a profile kept under Average
  // is written as the desktop writes its unselected multilevel model.
  const flown = launch.windLevels ?? [];
  const levels = flown.length ? flown : (launch.keptWindLevels ?? []);
  if (levels.length) {
    // The altitude reference is an attribute of <wind>, as OpenRocketSaver
    // writes it and importt/WindHandler reads it. As a child element the
    // desktop never looks at it. The value is lower case: the desktop writes
    // enumToXMLName and reads through DocumentConfig.findEnum, which matches
    // only the lower-case name, so "MSL" or "AGL" reads as no reference, flies
    // as AGL, and fails the desktop's next save.
    emit(depth, `<wind model="multilevel" altituderef="${launch.windAltitudeReference ?? 'msl'}">`);
    for (const l of levels) {
      // Attributes, not child elements, and direction in radians like the
      // average block's <direction>.
      emit(
        depth + 1,
        `<windlevel altitude="${l.altitudeM}" speed="${l.speed}" direction="${degToRad(l.directionDeg)}" standarddeviation="${l.stddev}"/>`,
      );
    }
    emit(depth, '</wind>');
  }
  emit(depth, `<windmodeltype>${flown.length ? 'Multilevel' : 'Average'}</windmodeltype>`);
}

function atmosphereXml(w: OrkWriter, depth: number, launch: LaunchConditions): void {
  const { emit } = w;
  if (launch.temperatureC === null && launch.pressureHPa === null && launch.relativeHumidity == null) {
    emit(depth, '<atmosphere model="isa"/>');
  } else {
    // Kelvin / pascal on disk. The desktop stores both-or-ISA, so a
    // single custom value fills the other with the ISA sea-level standard.
    emit(depth, '<atmosphere model="extendedisa">');
    emit(depth + 1, `<basetemperature>${(launch.temperatureC ?? 15) + 273.15}</basetemperature>`);
    emit(depth + 1, `<basepressure>${(launch.pressureHPa ?? 1013.25) * 100}</basepressure>`);
    // Only when set, so a file that never expressed humidity carries none.
    // <baserelativehumidity> is the element upstream OpenRocket writes and
    // reads (OpenRocketSaver, AtmosphereHandler). 24.12 has no humidity: it
    // flies dry air and warns on the element.
    if (launch.relativeHumidity != null) {
      emit(depth + 1, `<baserelativehumidity>${launch.relativeHumidity}</baserelativehumidity>`);
    }
    emit(depth, '</atmosphere>');
  }
}

/**
 * Where the weather-filled fields came from (the Weather dialog's stamp), as an
 * extension element desktop OpenRocket skips. Whether they were edited since is
 * decided at save time and written as `edited`, so the file needs no copy of the
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
 * A forecast atmosphere, as extension elements of this app's, directly in
 * <conditions>. No OpenRocket has such a model: their SimulationConditionsHandler
 * skips a <conditions> child it does not know without a warning, so a desktop
 * opening the file flies its own atmosphere. Inside <atmosphere> the same element
 * would warn on its attributes. Kelvin and pascal, like <basetemperature> and
 * <basepressure>.
 */
function forecastLevelsXml(w: OrkWriter, depth: number, levels: readonly AtmosphereLevel[]): void {
  for (const l of levels) {
    w.emit(
      depth,
      `<forecastlevel altitude="${l.altitudeM}" temperature="${l.temperatureC + 273.15}" pressure="${l.pressureHPa * 100}" relativehumidity="${l.relativeHumidity}"/>`,
    );
  }
}
