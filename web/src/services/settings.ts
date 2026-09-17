import type { PartKey } from './partColors';
import type { LaunchConditions } from './orkTree';
import {
  METRIC_UNITS,
  UNIT_CHOICES,
  type UnitChoice,
  normalizeUnitOverrides,
  normalizeUnits,
  type UnitOverrides,
  type UnitSelection,
} from '../prefs/units';

// Sea-level, calm, standard-atmosphere defaults (Cape Canaveral latitude).
const DEFAULT_LAUNCH: LaunchConditions = {
  launchRodLengthM: 1,
  launchRodAngleDeg: 0,
  launchRodDirectionDeg: 90,
  launchIntoWind: false,
  windAverage: 0,
  windStdDev: 0,
  windDirectionDeg: 90,
  launchAltitudeM: 0,
  latitudeDeg: 28.61,
  temperatureC: null,
  pressureHPa: null,
  geodetic: 'spherical',
};

/**
 * App-wide user preferences (not tied to a design): 3D part-colour overrides,
 * flight-path phase colours, and the default playback speed. Persisted to
 * localStorage synchronously so the very first render already has the user's
 * choices. Consumed reactively via the SettingsProvider / useSettings hook.
 */
/** Global simulation preferences (OpenRocket's Simulation prefs), applied to every run. */
export interface SimulationSettings {
  /** RK4 integration step (s) — smaller is more accurate but slower. OR default 0.05. */
  timeStep: number;
  /** Cap on simulated flight time (s) — ends a run that never lands. OR default 1200. */
  maxTime: number;
  /** Fixed seed for wind-turbulence reproducibility; null = random each run. */
  randomSeed: number | null;
  /** Ask for confirmation before deleting a simulation. */
  confirmDelete: boolean;
  /** Auto-run an outdated simulation when its results view is opened. */
  autoRunOutdated: boolean;
  /** Recovery-deployment speed (m/s) at/above which the deploy-speed tile warns
   *  (fast deployment risks zippering / hardware damage). Below = green. */
  deploymentSpeedWarn: number;
  /** Minimum safe rod/rail-exit velocity (m/s): the rod-exit tile is green at or
   *  above this, and warns below it (too slow to be stable off the rail). */
  railExitVelocityMin: number;
}

/** Which sides of the 2D side view carry a measurement ruler. */
export interface RulerSides {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

export interface Settings {
  /** The unit each quantity DEFAULTS to, as set in Settings ▸ Units. The tree,
   *  the kernel and every saved file stay SI — this is a display/entry
   *  preference only. */
  units: UnitSelection;
  /** Units changed from an inline unit chip. A separate layer over `units` so a
   *  chip never rewrites the defaults chosen in the dialog; see UnitOverrides. */
  unitOverrides: UnitOverrides;
  /** Per-group colour overrides for the 3D model (empty = built-in defaults). */
  partColors: Partial<Record<PartKey, string>>;
  /** Flight-path phase colours. */
  phaseColors: { boost: string; coast: string; descent: string };
  /**
   * How the Aero tables shade their cells.
   *
   * `sky` is one hue that strengthens with the value — a magnitude ramp, which
   * is what the numbers are. `openrocket` is desktop OpenRocket's green-to-red
   * heat, on its own absolute Cd scale and with dark text on light cells, for
   * anyone who reads that faster because they already know it.
   */
  aeroHeat: 'sky' | 'openrocket';
  /** Default flight-path playback speed (×). */
  playbackSpeed: number;
  /** Global simulation preferences. */
  simulation: SimulationSettings;
  /** Default launch conditions for newly-created simulations. */
  launchDefaults: LaunchConditions;
  /** Show the CG / CP / margin markers on the 2D & 3D views. */
  showMarkers: boolean;
  /** Show the length · mass · CG · CP · stability info card on the 2D & 3D views. */
  showInfoCard: boolean;
  /** Expand the "All stats" strip under the canvas (collapsed = just its header). */
  showStats: boolean;
  /** Which sides of the 2D side view are framed by a measurement ruler. */
  rulers: RulerSides;
  /** Write the derived <designinfo> statistics block into saved .ork files. Off
   *  by default, so a normal save is byte-identical to before. */
  saveDesignInfo: boolean;
  /** PDF report / template output preferences. */
  report: ReportSettings;
  /** Whether the user has dismissed the pre-1.0 "work in progress" notice. */
  wipAcknowledged: boolean;
}

/** Persistent output options for the PDF report (the "Settings" sub-dialog). */
export interface ReportSettings {
  /** Which units the report and the design CSV are written in. `current` follows
   *  the app's units; the other two pin the document to a system regardless of
   *  what the app is showing, which is what you want when it is for someone
   *  else. Absent/unknown reads as `current`. */
  units: UnitChoice;
  /** Template fill colour (hex), or '' for outline only. */
  templateFill: string;
  /** Template border colour (hex). */
  templateStroke: string;
  /** Page size. */
  paper: 'letter' | 'a4';
  /** Page orientation. */
  orientation: 'portrait' | 'landscape';
}

export const DEFAULT_REPORT: ReportSettings = {
  units: 'current',
  templateFill: '',
  templateStroke: '#111827',
  paper: 'letter',
  orientation: 'portrait',
};

export const DEFAULT_SETTINGS: Settings = {
  units: METRIC_UNITS,
  unitOverrides: {},
  partColors: {},
  phaseColors: { boost: '#fb923c', coast: '#38bdf8', descent: '#34d399' },
  aeroHeat: 'sky',
  playbackSpeed: 0.5,
  simulation: {
    timeStep: 0.05,
    maxTime: 1200,
    randomSeed: null,
    confirmDelete: true,
    autoRunOutdated: false,
    deploymentSpeedWarn: 20,
    railExitVelocityMin: 15,
  },
  launchDefaults: DEFAULT_LAUNCH,
  showMarkers: true,
  showInfoCard: true,
  showStats: true,
  rulers: { top: true, bottom: true, left: true, right: true },
  saveDesignInfo: false,
  report: DEFAULT_REPORT,
  wipAcknowledged: false,
};

const KEY = 'astrarrocketjs:settings:v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = JSON.parse(raw) as Partial<Settings> & { showRulers?: boolean };
    // Migrate the legacy single on/off flag → every side follows it; a saved
    // per-side object (if present) then wins over the migration.
    const legacyRulers =
      typeof s.showRulers === 'boolean'
        ? { top: s.showRulers, bottom: s.showRulers, left: s.showRulers, right: s.showRulers }
        : {};
    const savedRulers =
      s.rulers && typeof s.rulers === 'object'
        ? (Object.fromEntries(
            (['top', 'bottom', 'left', 'right'] as const)
              .filter((k) => typeof s.rulers![k] === 'boolean')
              .map((k) => [k, s.rulers![k]]),
          ) as Partial<RulerSides>)
        : {};
    return {
      // Unknown/absent symbols fall back per quantity, so an older store (which
      // has no `units` at all) keeps exactly the units it was displaying.
      units: normalizeUnits(s.units),
      unitOverrides: normalizeUnitOverrides(s.unitOverrides),
      partColors: { ...(s.partColors ?? {}) },
      phaseColors: { ...DEFAULT_SETTINGS.phaseColors, ...(s.phaseColors ?? {}) },
      // An older store has no value here, and an unrecognised one falls back
      // rather than leaving the tables with a style nothing renders.
      aeroHeat: s.aeroHeat === 'openrocket' ? 'openrocket' : DEFAULT_SETTINGS.aeroHeat,
      playbackSpeed: typeof s.playbackSpeed === 'number' ? s.playbackSpeed : DEFAULT_SETTINGS.playbackSpeed,
      simulation: (() => {
        const sim = { ...DEFAULT_SETTINGS.simulation, ...(s.simulation ?? {}) };
        // A corrupt/hand-edited timeStep or maxTime ≤ 0 makes the RK4 loop
        // (maxTime/timeStep steps) hang or NaN — clamp back to the default.
        const pos = (v: number, d: number) => (Number.isFinite(v) && v > 0 ? v : d);
        sim.timeStep = pos(sim.timeStep, DEFAULT_SETTINGS.simulation.timeStep);
        sim.maxTime = pos(sim.maxTime, DEFAULT_SETTINGS.simulation.maxTime);
        return sim;
      })(),
      launchDefaults: (() => {
        // Same reasoning as the `simulation` block above, which has clamped for
        // exactly this reason: every field here reaches simConditions() and then
        // simulate() for each NEW simulation, unchecked. A hand-edited or
        // future-version blob putting a string, null or NaN where the engine
        // wants a number crossed straight into the kernel.
        //
        // The two nullable fields are left alone: `temperatureC` and
        // `pressureHPa` are `number | null` on purpose — null means "the ISA
        // standard atmosphere", which is a real answer, not a missing one.
        const l = { ...DEFAULT_SETTINGS.launchDefaults, ...(s.launchDefaults ?? {}) };
        // Split so the fallback keeps each field's own type: a required number
        // always gets a number back, an optional one may legitimately be absent.
        for (const k of [
          'launchRodLengthM',
          'launchRodAngleDeg',
          'windAverage',
          'windStdDev',
          'launchAltitudeM',
          'latitudeDeg',
        ] as const) {
          if (!Number.isFinite(l[k])) l[k] = DEFAULT_SETTINGS.launchDefaults[k];
        }
        for (const k of ['launchRodDirectionDeg', 'windDirectionDeg', 'longitudeDeg'] as const) {
          // Absent stays absent — only a PRESENT but unusable value falls back.
          if (l[k] !== undefined && !Number.isFinite(l[k])) l[k] = DEFAULT_SETTINGS.launchDefaults[k];
        }
        for (const k of ['temperatureC', 'pressureHPa'] as const) {
          const v = l[k];
          if (v !== null && !Number.isFinite(v)) l[k] = DEFAULT_SETTINGS.launchDefaults[k];
        }
        if (typeof l.launchIntoWind !== 'boolean' && l.launchIntoWind !== undefined) {
          l.launchIntoWind = DEFAULT_SETTINGS.launchDefaults.launchIntoWind;
        }
        if (l.geodetic !== undefined && !['flat', 'spherical', 'wgs84'].includes(l.geodetic)) {
          l.geodetic = DEFAULT_SETTINGS.launchDefaults.geodetic;
        }
        if (l.windLevels !== undefined && !Array.isArray(l.windLevels)) {
          l.windLevels = DEFAULT_SETTINGS.launchDefaults.windLevels;
        }
        return l;
      })(),
      showMarkers: typeof s.showMarkers === 'boolean' ? s.showMarkers : DEFAULT_SETTINGS.showMarkers,
      showInfoCard: typeof s.showInfoCard === 'boolean' ? s.showInfoCard : DEFAULT_SETTINGS.showInfoCard,
      showStats: typeof s.showStats === 'boolean' ? s.showStats : DEFAULT_SETTINGS.showStats,
      rulers: { ...DEFAULT_SETTINGS.rulers, ...legacyRulers, ...savedRulers },
      saveDesignInfo: typeof s.saveDesignInfo === 'boolean' ? s.saveDesignInfo : DEFAULT_SETTINGS.saveDesignInfo,
      report: (() => {
        const r = { ...DEFAULT_REPORT, ...(s.report ?? {}) };
        // A hand-edited or future-version choice falls back rather than being
        // handed to resolveUnitChoice, where it would silently mean `current`.
        if (!UNIT_CHOICES.includes(r.units)) r.units = DEFAULT_REPORT.units;
        return r;
      })(),
      wipAcknowledged: typeof s.wipAcknowledged === 'boolean' ? s.wipAcknowledged : DEFAULT_SETTINGS.wipAcknowledged,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage disabled */
  }
}
