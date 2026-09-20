import type { LaunchConditions } from '../orkTree';
import { escapeXml } from '../xmlUtil';
import { turbulenceIntensity } from '../windTurbulence';
import type { OrkWriter } from './exportWriter';

/**
 * The <simulations> block: one <simulation> carrying the launch panel's
 * conditions (rod, wind, site, atmosphere), or the empty wrapper when the
 * caller has no launch conditions to save.
 */
export function simulationsXml(w: OrkWriter, depth: number, launch: LaunchConditions | undefined): void {
  const { emit } = w;
  emit(depth, '<simulations>');
  if (launch) {
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

function conditionsXml(w: OrkWriter, depth: number, launch: LaunchConditions): void {
  const { emit } = w;
  emit(depth, `<configid>${escapeXml(w.defaultId)}</configid>`);
  emit(depth, `<launchrodlength>${launch.launchRodLengthM ?? 0}</launchrodlength>`);
  // The app edits launch-into-wind, the rod heading, the wind heading and
  // the longitude (LaunchPanel), and this writer used to emit the desktop's
  // preference defaults for all four, so a save threw the user's own
  // settings away. Units per OpenRocketSaver.java:349-354: the rod heading
  // is DEGREES on disk (written as radians * 360 / 2pi, like the rod angle);
  // the wind heading is RADIANS (getDirection() written raw). The fallbacks
  // are the desktop's own defaults, used only when the field was never set.
  emit(depth, `<launchintowind>${launch.launchIntoWind === true}</launchintowind>`);
  emit(depth, `<launchrodangle>${launch.launchRodAngleDeg ?? 0}</launchrodangle>`);
  emit(depth, `<launchroddirection>${launch.launchRodDirectionDeg ?? 90}</launchroddirection>`);
  windXml(w, depth, launch);
  emit(depth, `<launchaltitude>${launch.launchAltitudeM ?? 0}</launchaltitude>`);
  emit(depth, `<launchlatitude>${launch.latitudeDeg ?? 0}</launchlatitude>`);
  // Degrees; the desktop's preference default when the site was never set.
  emit(depth, `<launchlongitude>${launch.longitudeDeg ?? -80.6}</launchlongitude>`);
  emit(depth, `<geodeticmethod>${launch.geodetic ?? 'spherical'}</geodeticmethod>`);
  // Gravity: only written when it is NOT the default, so a file that never
  // touched it stays byte-comparable with what we used to produce.
  if (launch.gravityModel === 'constant') {
    emit(depth, '<gravitymodel>Constant</gravitymodel>');
    emit(depth, `<constantgravity>${launch.constantGravity ?? 9.80665}</constantgravity>`);
  }
  atmosphereXml(w, depth, launch);
  // RK4SimulationStepper recommended defaults (the desktop's own values).
  emit(depth, '<timestep>0.05</timestep>');
  emit(depth, '<maxtime>1200.0</maxtime>');
}

function windXml(w: OrkWriter, depth: number, launch: LaunchConditions): void {
  const { emit } = w;
  const windDirRad = ((launch.windDirectionDeg ?? 90) * Math.PI) / 180;
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
    // OpenRocketSaver.java:367 writes it and importt/WindHandler.java:25
    // reads it. It used to go out as a child element the desktop never
    // looks at, so an AGL profile saved here opened on the desktop as MSL.
    emit(depth, `<wind model="multilevel" altituderef="${(launch.windAltitudeReference ?? 'msl').toUpperCase()}">`);
    for (const l of levels) {
      // Attributes, not child elements, and direction in RADIANS like the
      // average block's <direction>.
      emit(
        depth + 1,
        `<windlevel altitude="${l.altitudeM}" speed="${l.speed}" direction="${(l.directionDeg * Math.PI) / 180}" standarddeviation="${l.stddev}"/>`,
      );
    }
    emit(depth, '</wind>');
  }
  emit(depth, `<windmodeltype>${levels.length ? 'Multilevel' : 'Average'}</windmodeltype>`);
}

function atmosphereXml(w: OrkWriter, depth: number, launch: LaunchConditions): void {
  const { emit } = w;
  if (launch.temperatureC === null && launch.pressureHPa === null && launch.relativeHumidity == null) {
    emit(depth, '<atmosphere model="isa"/>');
  } else {
    // KELVIN / PASCAL on disk. The desktop stores both-or-ISA, so a
    // single custom value fills the other with the ISA sea-level standard.
    emit(depth, '<atmosphere model="extendedisa">');
    emit(depth + 1, `<basetemperature>${(launch.temperatureC ?? 15) + 273.15}</basetemperature>`);
    emit(depth + 1, `<basepressure>${(launch.pressureHPa ?? 1013.25) * 100}</basepressure>`);
    // Only when set: the desktop's atmosphere element carries temperature and
    // pressure, so an unconditional humidity child would put something in
    // every file for a value most of them never expressed.
    if (launch.relativeHumidity != null) {
      emit(depth + 1, `<relativehumidity>${launch.relativeHumidity}</relativehumidity>`);
    }
    emit(depth, '</atmosphere>');
  }
}
