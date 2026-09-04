import type { PartKey } from './partColors';
import type { LaunchConditions } from './orkTree';

// Sea-level, calm, standard-atmosphere defaults (Cape Canaveral latitude).
export const DEFAULT_LAUNCH: LaunchConditions = {
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

export interface Settings {
  /** Per-group colour overrides for the 3D model (empty = built-in defaults). */
  partColors: Partial<Record<PartKey, string>>;
  /** Flight-path phase colours. */
  phaseColors: { boost: string; coast: string; descent: string };
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
  /** Whether the user has dismissed the pre-1.0 "work in progress" notice. */
  wipAcknowledged: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  partColors: {},
  phaseColors: { boost: '#fb923c', coast: '#38bdf8', descent: '#34d399' },
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
  wipAcknowledged: false,
};

const KEY = 'astrarrocketjs:settings:v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      partColors: { ...(s.partColors ?? {}) },
      phaseColors: { ...DEFAULT_SETTINGS.phaseColors, ...(s.phaseColors ?? {}) },
      playbackSpeed: typeof s.playbackSpeed === 'number' ? s.playbackSpeed : DEFAULT_SETTINGS.playbackSpeed,
      simulation: { ...DEFAULT_SETTINGS.simulation, ...(s.simulation ?? {}) },
      launchDefaults: { ...DEFAULT_SETTINGS.launchDefaults, ...(s.launchDefaults ?? {}) },
      showMarkers: typeof s.showMarkers === 'boolean' ? s.showMarkers : DEFAULT_SETTINGS.showMarkers,
      showInfoCard: typeof s.showInfoCard === 'boolean' ? s.showInfoCard : DEFAULT_SETTINGS.showInfoCard,
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
