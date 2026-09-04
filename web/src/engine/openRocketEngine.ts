/**
 * Typed wrapper around the TeaVM-compiled OpenRocket kernel
 * (vendor/openrocket-engine.mjs — rebuilt via engine-java (see README)).
 *
 * Engine invariants: pure SI units (m, kg, s, N), angles in RADIANS.
 * Documented exceptions: launchLatitude/launchLongitude are DEGREES.
 * See engine-java/ for the kernel, shims, patches and differential tests.
 */
// MUST stay above the engine load: it installs the TeaVM stdout/stderr sinks
// that the kernel module reads once, as it evaluates. ES modules evaluate in
// import order, so this eager import must precede the DYNAMIC engine load below
// (neither backend is imported statically now) — see kernelLogSink.ts.
import './kernelLogSink.js';

// The WASM-GC engine + its loader live in web/public/engine/ (served verbatim by
// Vite — a .js in src/ would be run through import-analysis, which warns on the
// loader's internal dynamic imports). Absent files → clean JS fallback.
const WASM_URL = `${import.meta.env.BASE_URL}engine/openrocket-engine.wasm`;
const WASM_RUNTIME_URL = `${import.meta.env.BASE_URL}engine/openrocket-engine.wasm-runtime.js`;

// --- Engine backend ---------------------------------------------------------
// Both engines are DYNAMICALLY loaded — neither is in the initial bundle.
// initEngine() loads the TeaVM WASM-GC build when the browser supports it
// (faster, smaller), otherwise the JS build as a fallback. Only ONE engine is
// ever fetched. EngineApi is a type-only import (erased at build), so it pulls
// nothing into the bundle.
type EngineApi = typeof import('./vendor/openrocket-engine.mjs');
let active: EngineApi | null = null;
let initPromise: Promise<'wasm' | 'js'> | null = null;

/** The active engine; throws if initEngine() hasn't resolved yet (main.tsx awaits it before mount). */
function eng(): EngineApi {
  if (!active) {
    throw new Error('OpenRocket engine not initialised — await initEngine() before using it.');
  }
  return active;
}

/** Dynamically import the JS engine as its own chunk — loaded only when WASM is unavailable. */
async function loadJsEngine(): Promise<EngineApi> {
  return await import('./vendor/openrocket-engine.mjs');
}

/** Load the WASM-GC runtime once (it installs globalThis.TeaVM.wasmGC). */
function loadWasmRuntime(): Promise<void> {
  const g = globalThis as unknown as { TeaVM?: { wasmGC?: unknown } };
  if (g.TeaVM?.wasmGC) return Promise.resolve();
  // In a Worker there's no `document`, so we can't inject a <script>, and Vite
  // won't serve a /public file via import(). Fetch the runtime text and import
  // it through a Blob URL: running the module executes its IIFE, which assigns
  // globalThis.TeaVM as a side effect (see openrocket-engine.wasm-runtime.js) —
  // no eval, and blob URLs aren't behind Vite's /public wall. Lets WASM also run
  // inside the sim worker; on any failure tryLoadWasm falls the worker back to JS.
  if (typeof document === 'undefined') {
    return fetch(WASM_RUNTIME_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`WASM-GC runtime fetch failed (${r.status})`);
        return r.text();
      })
      .then(async (src) => {
        const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        try {
          await import(/* @vite-ignore */ url);
        } finally {
          URL.revokeObjectURL(url);
        }
      });
  }
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = WASM_RUNTIME_URL;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('WASM-GC runtime failed to load'));
    document.head.appendChild(s);
  });
}

/**
 * Route the WASM kernel's stdout/stderr into the SAME sink the JS backend uses.
 * The WASM runtime's default `teavmConsole` writes every char-buffered line
 * straight to console.log/console.error, so OpenRocket's per-flight INFO spam
 * ("Starting simulation of branch", "Igniting motor", …) floods the console —
 * and stderr lands as console.error. The runtime's `load()` runs
 * `options.installImports(imports)` AFTER building its defaults, so we replace
 * `teavmConsole` here with putchar functions that buffer to newline and forward
 * whole lines to `$rt_putStdoutCustom`/`$rt_putStderrCustom` — the globals
 * kernelLogSink.ts installs (eager import, so they exist by now). Both backends
 * then feed one ring buffer; the console stays clean.
 */
function installKernelConsole(imports: Record<string, unknown>): void {
  const g = globalThis as Record<string, unknown>;
  const pump = (globalName: string) => {
    let buf = '';
    return (c: number) => {
      if (c === 10) {
        const custom = g[globalName];
        if (typeof custom === 'function') (custom as (s: string) => void)(buf);
        buf = '';
      } else {
        buf += String.fromCharCode(c);
      }
    };
  };
  imports.teavmConsole = {
    putcharStdout: pump('$rt_putStdoutCustom'),
    putcharStderr: pump('$rt_putStderrCustom'),
  };
}

async function tryLoadWasm(): Promise<EngineApi | null> {
  try {
    if (typeof WebAssembly !== 'object' || typeof WebAssembly.compileStreaming !== 'function') {
      return null;
    }
    // Load the runtime IIFE via a <script> tag; it installs globalThis.TeaVM.wasmGC.
    await loadWasmRuntime();
    const wasmGC = (globalThis as unknown as {
      TeaVM?: { wasmGC?: { load(src: ArrayBuffer, options?: unknown): Promise<{ exports: unknown }> } };
    }).TeaVM?.wasmGC;
    if (!wasmGC?.load) return null;
    // Fetch the bytes ourselves and hand them to load() — passing an ArrayBuffer
    // takes the WebAssembly.compile(bytes) path, sidestepping the runtime's
    // Node-vs-browser (fs vs fetch) detection entirely. installImports rewires
    // the kernel's console output into the shared log sink (see above).
    const res = await fetch(WASM_URL);
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    const teavm = await wasmGC.load(bytes, { installImports: installKernelConsole });
    const exports = teavm.exports as EngineApi;
    // The @JSExport facade must be callable across the WASM↔JS boundary.
    if (typeof exports.buildRocket !== 'function') return null;
    return exports;
  } catch (e) {
    console.warn('[engine] WASM-GC unavailable — using the JS engine.', e);
    return null;
  }
}

/**
 * Backend preference. Default is 'auto' → try WASM-GC first, fall back to JS
 * (the requested "WASM with JS fallback"). WASM-GC runs our OpenRocket 24.12
 * kernel bit-identically to JS once the WASM-hostile cast in
 * `info.openrocket.core.util.ArrayList.clone()` is patched (it did
 * `(ArrayList) super.clone()`, which throws ClassCastException under WASM-GC's
 * strict typing — see the PATCH in engine-java). Overrides for debugging /
 * unsupported browsers: `?engine=js` (or `localStorage.setItem('engine','js')`)
 * forces JS; `?engine=wasm` forces the WASM attempt.
 */
function backendPref(): 'wasm' | 'js' | 'auto' {
  try {
    const q = new URLSearchParams(location.search).get('engine');
    if (q === 'wasm' || q === 'js') return q;
    const ls = localStorage.getItem('engine');
    if (ls === 'wasm' || ls === 'js') return ls;
  } catch {
    /* no location/localStorage (SSR/tests) → auto */
  }
  return 'auto';
}

/**
 * Load the engine backend once: WASM-GC first (unless `?engine=js` forces JS or
 * the browser lacks WASM), else the JS build as a fallback. Idempotent. MUST be
 * awaited before any engine use (main.tsx awaits it before mounting) — engine
 * calls before it resolves throw, since neither backend is loaded until now.
 * Resolves to which backend is active.
 */
export function initEngine(): Promise<'wasm' | 'js'> {
  if (!initPromise) {
    initPromise = (async () => {
      const wasm = backendPref() === 'js' ? null : await tryLoadWasm();
      if (wasm) { active = wasm; return 'wasm'; }
      active = await loadJsEngine();
      return 'js';
    })();
  }
  return initPromise;
}

export type NoseShape = 'ogive' | 'conical' | 'ellipsoid' | 'power' | 'parabolic' | 'haack';

export interface RocketSpec {
  noseCone: {
    length: number;
    aftRadius: number;
    thickness: number;
    shape?: NoseShape;
    /** Bulk density kg/m^3; omit for OpenRocket's default material. */
    materialDensity?: number;
    /** Selected material name (display / .ork round-trip only; density drives physics). */
    material?: string;
  };
  bodyTube: {
    length: number;
    outerRadius: number;
    thickness: number;
    materialDensity?: number;
    material?: string;
  };
  fins: {
    count: number;
    rootChord: number;
    tipChord: number;
    sweep: number;
    height: number;
    thickness: number;
    materialDensity?: number;
    material?: string;
  };
  motorMount: {
    length: number;
    outerRadius: number;
    thickness: number;
  };
  parachute?: {
    diameter: number;
    dragCoefficient?: number;
  };
}

export interface MotorSpec {
  designation: string;
  /** Manufacturer name/abbreviation (display only; the engine ignores it). */
  manufacturer?: string;
  diameter: number;
  length: number;
  /** Thrust curve: times[i] (s) -> thrusts[i] (N); masses[i] = motor mass (kg) at times[i]. */
  times: number[];
  thrusts: number[];
  masses: number[];
  /** Motor CG position from its leading end (m). */
  cgX: number;
  /** Ejection-charge delay (s). Use {@link PLUGGED_DELAY} for a plugged motor. */
  ejectionDelay: number;
  /** Which bundled thrust curve this was built from (e.g. "Certified · RASP") — display only. */
  curveSrc?: string;
}

/**
 * JSON-safe sentinel for a plugged motor (no ejection charge). OpenRocket's
 * kernel uses `Motor.PLUGGED_DELAY = Double.POSITIVE_INFINITY`, but Infinity
 * cannot survive JSON (localStorage persistence and the motor cache serialize
 * it to null), so we store this finite value and map it back to Infinity only
 * at the kernel boundary — see {@link toKernelDelay}.
 */
export const PLUGGED_DELAY = 1e9;

/** Map the stored ejection delay to what the kernel expects (Infinity = plugged). */
const toKernelDelay = (d: number): number => (d >= PLUGGED_DELAY ? Infinity : d);

export interface SimulationOptions {
  launchRodLength?: number;
  /** Radians from vertical. */
  launchRodAngle?: number;
  /** Launch-rod compass heading, RADIANS (default π/2). */
  launchRodDirection?: number;
  windAverage?: number;
  windStdDeviation?: number;
  /** Wind heading, RADIANS. Ignored when windLevels is set. */
  windDirection?: number;
  /** Altitude-layered wind (overrides windAverage/StdDev/Direction when non-empty).
   *  altitude m (MSL), speed m/s, direction radians, stddev m/s. */
  windLevels?: { altitude: number; speed: number; direction: number; stddev: number }[];
  /** Earth model for the trajectory: 'flat' | 'spherical' (default) | 'wgs84'. */
  geodetic?: 'flat' | 'spherical' | 'wgs84';
  launchAltitude?: number;
  /** Launch-site temperature (K). Default: ISA standard. */
  temperature?: number;
  /** Launch-site pressure (Pa). Default: ISA standard. */
  pressure?: number;
  /** DEGREES (exception to the radians rule — WorldCoordinate's own unit). */
  launchLatitude?: number;
  /** DEGREES (exception to the radians rule). */
  launchLongitude?: number;
  timeStep?: number;
  maxTime?: number;
  randomSeed?: number;
  /**
   * Series payload mode. 'summary' (the default) returns the 12 friendly-named
   * arrays plus only the symbol series the app's flight report reads every run
   * (Pl, θl, Px, Py, dΦ). 'full' additionally returns every series the branch
   * carries — except tc (wall-clock noise, nondeterministic) and the symbols
   * duplicating the friendly dozen. Full costs ~45% extra single-sim wall
   * clock in serialization, so request it only when the extra series are
   * actually consumed (plot pickers, CSV export).
   */
  series?: 'summary' | 'full';
}

export interface StaticInfo {
  length: number;
  /** Launch mass (kg) — includes the motor when one is set. */
  mass: number;
  /** Dry structure mass (kg) — no motor. */
  massEmpty: number;
  /** Dry structure CG (m from nose tip) — no motor. */
  cgEmpty: number;
  /** Launch CG (m from nose tip) — includes the motor when one is set. */
  cg: number;
  cp: number;
  cna: number;
  stabilityCalibers: number;
  refDiameter: number;
  warnings: number;
  /** Engine warning messages (geometry problems etc.). */
  warningTexts: string[];
}

// ---------- Component-tree API (P2.1) ----------

export type ComponentType =
  | 'stage'
  | 'nosecone' | 'transition' | 'bodytube'
  | 'trapezoidfinset' | 'ellipticalfinset' | 'freeformfinset' | 'tubefinset'
  | 'innertube' | 'tubecoupler' | 'centeringring' | 'bulkhead' | 'engineblock'
  | 'launchlug' | 'railbutton'
  // App-level component: the editor's engineTree() lowers a fairing to a
  // kernel strake-fin + CD/mass overrides before buildTree — the kernel
  // itself never sees this type.
  | 'fairing'
  | 'parachute' | 'streamer' | 'shockcord' | 'masscomponent'
  // Off-axis assemblies (ComponentAssembly): a non-separating pod, or a
  // separable parallel booster. Nested under a body component, never at the
  // rocket root. Kernel support (PodSet/ParallelStage) is compiled in; the
  // JS-bridge build path lands in a later phase.
  | 'podset' | 'parallelstage';

/**
 * Stage separation trigger (lower stages only; desktop default "ejection").
 * On a `stage` node: `separationEvent`, `separationDelay` (s),
 * `separationAltitude` (m, for the altitude events), and `nozzleExitDiameter`
 * (m; RASAero power-on base-drag reduction, 0/absent = power-off, all stages).
 */
export type SeparationEvent =
  | 'launch' | 'ignition' | 'burnout' | 'ejection' | 'upperignition'
  | 'altitudeascending' | 'apogee' | 'altitudedescending' | 'never';

/**
 * When a mount's motor ignites. "automatic" = launch-stage motors at launch,
 * upper-stage motors on the ejection charge of the stage below (the low/mid-
 * power pattern). High-power sustainers use electronics: "burnout" or
 * "launch" plus a timer delay.
 */
export type IgnitionEvent = 'automatic' | 'launch' | 'ejectioncharge' | 'burnout' | 'never';

export interface ComponentPosition {
  method: 'top' | 'middle' | 'bottom' | 'absolute';
  /** meters, per the method's convention */
  offset: number;
}

/**
 * A component-tree node. `type` selects the component; the remaining keys are
 * that type's parameters (SI units, radians — see engine-java ComponentFactory
 * for the full per-type list). Nodes with an `id` can be addressed later,
 * e.g. as motor mounts.
 */
export interface ComponentNode {
  type: ComponentType;
  id?: string;
  name?: string;
  /** Bulk material density (kg/m^3). */
  density?: number;
  position?: ComponentPosition;
  children?: ComponentNode[];
  [param: string]: unknown;
}

export interface RocketTree {
  name?: string;
  components: ComponentNode[];
}

export interface FlightSummary {
  maxAltitude: number;
  maxVelocity: number;
  maxAcceleration: number;
  maxMachNumber: number;
  timeToApogee: number;
  flightTime: number;
  groundHitVelocity: number;
  /** Velocity when clearing the launch rod/rail (m/s). */
  launchRodVelocity: number;
  /** Velocity at recovery-device deployment (m/s); null if never deployed. */
  deploymentVelocity: number | null;
  /**
   * Kernel-computed optimum ejection delay (s): coast time from burnout to
   * BALLISTIC apogee (a deployment-free probe flight — not the deployed
   * flight's apogee). null when not computable.
   */
  optimumDelay: number | null;
}

export interface FlightEvent {
  type: string;
  time: number;
  /**
   * Name of the component that raised the event (present for events with a
   * source, e.g. RECOVERY_DEVICE_DEPLOYMENT carries the parachute's name —
   * how dual-deployment drogue and main are told apart).
   */
  source?: string;
}

export interface FlightSeries {
  time: number[];
  altitude: number[];
  velocity: number[];
  acceleration: number[];
  mass: number[];
  thrust: number[];
  drag: number[];
  mach: number[];
  /** Stability margin (calibers). */
  stability: number[];
  cpLocation: number[];
  cgLocation: number[];
  /** Angle of attack (rad). */
  aoa: number[];
  /**
   * Symbol-keyed series beyond the friendly-named dozen above. Which symbols
   * are present depends on {@link SimulationOptions.series}: 'summary' (the
   * default) carries only Pl, θl, Px, Py, dΦ — the ones the app's flight
   * report reads every run; 'full' carries every series the branch records
   * ("Vz", "Cdf", "ρ"…) except tc (wall-clock noise) and the symbols that
   * would duplicate the friendly dozen ("t", "h"…). NaN/Infinity samples
   * arrive as null (JSON), hence the (number | null)[] element type; the
   * named arrays share that wire behavior. Always check for undefined
   * before use.
   */
  [symbol: string]: (number | null)[] | undefined;
}

/**
 * One flight branch of a staged rocket: branch 0 is the sustainer stack
 * (same data as the top-level events/series); each further branch is a
 * separated booster's own flight — its descent, recovery and ground hit.
 */
export interface FlightBranch {
  /** Stage name from the design ("Sustainer", "Booster"…). */
  name: string;
  events: FlightEvent[];
  series: FlightSeries;
}

/**
 * One simulation warning (large AoA, high-speed deployment, no recovery
 * device…). ABSENT on engine artifacts predating the warning export.
 */
export interface EngineWarning {
  /**
   * Stable machine key: the typed Warning subclass name ("LargeAOA",
   * "HighSpeedDeployment", "EventAfterLanding", "MissingMotor") or the
   * kernel's l10n key for the singleton warnings ("NO_RECOVERY_DEVICE",
   * "TUMBLE_UNDER_THRUST", "SUPERSONIC"…); "Other" when neither applies.
   */
  key: string;
  /** Human message incl. source component names (Warning.toString()). */
  message: string;
  /** MessagePriority export label. */
  priority?: 'LOW' | 'NORMAL' | 'HIGH';
}

export interface FlightResult {
  /** Whole-flight summary (branch 0 = the sustainer stack). */
  summary: FlightSummary;
  events: FlightEvent[];
  series: FlightSeries;
  /** Present only for staged flights that actually separated (≥2 branches). */
  branches?: FlightBranch[];
  /**
   * Simulation warnings (whole flight, not per-branch). Optional: the
   * committed vendor orkengine.mjs predates the export — arrives after the
   * next engine rebuild.
   */
  warnings?: EngineWarning[];
  /** The same warnings as plain text — the shape staticInfo() uses. */
  warningTexts?: string[];
}

/** Per-component static info (SI), from OpenRocketDesign.componentInfo(). */
export interface ComponentInfo {
  /** Component's own length (m). */
  length: number;
  /**
   * The component's own mass (kg), override-aware. For a fin SET this is the
   * mass of ALL fins combined (OpenRocket semantics — overrides too).
   */
  mass: number;
  /** Mass of the component plus all its children (kg). */
  sectionMass: number;
  /** CG measured from the component's own front (m). */
  cgX: number;
  /** Absolute position of the component's front from the nose tip (m). */
  positionX: number;
}

/** Options for {@link OpenRocketDesign.dragSweep}; a Mach grid at a fixed angle. */
export interface DragSweepOptions {
  /** First Mach (default 0.05). */
  machMin?: number;
  /** Last Mach (default 3.0). */
  machMax?: number;
  /** Mach increment (default 0.05). */
  machStep?: number;
  /** Angle of attack in degrees (default 0 — the zero-alpha drag polar). */
  aoaDeg?: number;
  /**
   * Optional Reynolds matching: [mach, altitude m] pairs pin the ISA
   * atmosphere (hence Re) per Mach point, linearly interpolated — the same
   * mechanism as RASAero's Mach-Alt table. Absent ⇒ sea level throughout.
   */
  machAlt?: [number, number][];
}

/** One power state's drag coefficients across the Mach grid (index-aligned to `machs`). */
export interface DragCurve {
  /** Total CD per Mach. */
  total: number[];
  /** Skin-friction CD per Mach. */
  friction: number[];
  /** Pressure/wave CD per Mach. */
  pressure: number[];
  /** Base CD per Mach (the power-on curve reflects the nozzle-exit reduction). */
  base: number[];
}

/**
 * Drag polar sweep (RASAero-style Aero Plots). A static design property — no
 * flight required. NOTE: the underlying method is Extended Barrowman: accurate
 * subsonic/transonic, approximate above ~Mach 1.5-2 (full supersonic fidelity
 * is a later feature). The UI labels the supersonic region accordingly.
 */
export interface DragSweep {
  /** Mach grid (x-axis for every curve). */
  machs: number[];
  /** Whether any stage sets a nozzle exit diameter (so power-on differs from power-off). */
  hasNozzle: boolean;
  /**
   * CP location per Mach (m from the nose tip), at the sweep's angle of attack.
   * Power state doesn't move CP, so one curve serves both. Feeds the
   * validation harness and CP-vs-Mach plotting.
   */
  cp: number[];
  /** Normal-force-coefficient slope CNα per Mach (per radian, kernel reference area). */
  cna: number[];
  /** Coast (motors off) drag. */
  powerOff: DragCurve;
  /** Boost (all stages thrusting) drag — differs from powerOff only when hasNozzle. */
  powerOn: DragCurve;
  /** Per-component power-off total CD (index-aligned to `machs`). */
  components: { name: string; cd: number[] }[];
}

/**
 * Guards the motor curve before it crosses into the kernel. TeaVM reports a
 * non-finite number as an opaque BigInt conversion RangeError from deep inside
 * the compiled Java, so catching it here is the difference between a message
 * naming the motor and a design that silently blanks.
 */
function assertFiniteCurve(motor: MotorSpec): void {
  const bad = (xs: readonly number[]) => !xs.every((n) => Number.isFinite(n));
  if (bad(motor.times) || bad(motor.thrusts) || bad(motor.masses)) {
    throw new Error(
      `Motor ${motor.designation}: thrust curve contains non-finite values ` +
        '(a missing published weight or a malformed .rse/.eng file).',
    );
  }
  if (motor.masses.some((m) => m < 0)) {
    throw new Error(
      `Motor ${motor.designation}: thrust curve ends at a negative mass ` +
        '(propellant mass exceeds loaded mass).',
    );
  }
  // A motor that weighs nothing for the whole burn is not a motor. The kernel
  // simulates it happily and returns an optimistic flight, so catch it here:
  // the real-world source is an .rse whose samples carry no mass attribute.
  if (motor.masses.length > 0 && motor.masses.every((m) => m === 0)) {
    throw new Error(
      `Motor ${motor.designation}: thrust curve carries no mass at any point ` +
        '(the motor file is missing its per-sample masses).',
    );
  }
}

/** A rocket design held inside the engine, addressed by handle. */
export class OpenRocketDesign {
  private readonly handle: number;

  private constructor(handle: number) {
    this.handle = handle;
  }

  /**
   * Builds a rocket from an arbitrary component tree (Phase 2 API).
   * Give the motor-mount inner tube an `id` and pass it to setMotorById.
   */
  static buildTree(tree: RocketTree): OpenRocketDesign {
    const handle = eng().buildRocket(JSON.stringify(tree));
    return new OpenRocketDesign(handle);
  }

  /** Attaches a motor to the mount with the given node id (buildTree rockets). */
  setMotorById(componentId: string, motor: MotorSpec): void {
    // Reject a malformed curve at the package boundary. A NaN in `masses` used
    // to surface as TeaVM's internal "The number NaN cannot be converted to a
    // BigInt", which told the user nothing and blanked their design; catalog
    // data with missing weights is the real-world source (see thrustcurve.ts).
    assertFiniteCurve(motor);
    eng().setMotorById(
      this.handle, componentId, motor.designation, motor.diameter, motor.length,
      motor.times, motor.thrusts, motor.masses, motor.cgX, toKernelDelay(motor.ejectionDelay));
  }

  /**
   * Overrides WHEN this mount's motor ignites (call after setMotorById).
   * Staged rockets: "automatic" is the low/mid-power default; high-power
   * sustainers are electronics-timed — e.g. ('burnout', 1.0) for booster
   * burnout + 1 s.
   */
  setMotorIgnitionById(componentId: string, event: IgnitionEvent, delayS = 0): void {
    eng().setMotorIgnitionById(this.handle, componentId, event, delayS);
  }

  /**
   * Enable the opt-in "Rogers Modified Barrowman" body-in-presence-of-fins
   * interference (Kbf). Affects both the reported static CP/stability and the
   * flight sim. Call before {@link staticInfo}/{@link simulate}. Off by default;
   * off ⇒ classic Barrowman (bit-identical to before).
   */
  setRogersModifiedBarrowman(enabled: boolean): void {
    eng().setRogersModifiedBarrowman(this.handle, enabled);
  }

  /**
   * Enable the opt-in supersonic aerodynamics model (RASAero feature #1,
   * Phase 1): corrected supersonic fin normal force, exact NACA-1307 body-fin
   * interference, and Mach-dependent nose CNα — CP moves with Mach above M1
   * instead of collapsing forward. Affects staticInfo, simulate and dragSweep.
   * Off by default; off ⇒ classic Extended Barrowman (bit-identical).
   * Validated against the wind-tunnel anchor suite in validation/.
   */
  setSupersonicAero(enabled: boolean): void {
    eng().setSupersonicAero(this.handle, enabled);
  }

  /** Length, mass, CG/CP, stability margin — computed at Mach 0.3, AoA 0. */
  staticInfo(): StaticInfo {
    const parsed = JSON.parse(eng().getStaticInfo(this.handle)) as StaticInfo & { error?: string };
    if (parsed.error) throw new Error(`Static analysis failed: ${parsed.error}`);
    return parsed;
  }

  /** Static info for one component, addressed by its tree-node id. */
  componentInfo(componentId: string): ComponentInfo {
    const parsed = JSON.parse(eng().getComponentInfo(this.handle, componentId)) as ComponentInfo & { error?: string };
    if (parsed.error) throw new Error(`Component info failed: ${parsed.error}`);
    return parsed;
  }

  /**
   * Drag polar sweep (CD vs Mach) with power-off/power-on curves and a
   * per-component breakdown. Static — no flight needed. See {@link DragSweep}.
   */
  dragSweep(options: DragSweepOptions = {}): DragSweep {
    const raw = eng().getDragSweep(this.handle, JSON.stringify({
      machMin: options.machMin ?? 0.05,
      machMax: options.machMax ?? 3.0,
      machStep: options.machStep ?? 0.05,
      aoaDeg: options.aoaDeg ?? 0,
      machAlt: options.machAlt,
    }));
    const parsed = JSON.parse(raw) as DragSweep & { error?: string };
    if (parsed.error) throw new Error(`Drag sweep failed: ${parsed.error}`);
    return parsed;
  }

  simulate(options: SimulationOptions = {}): FlightResult {
    const raw = eng().simulateJson(this.handle, JSON.stringify({
      rodLength: options.launchRodLength ?? 1.0,
      rodAngle: options.launchRodAngle ?? 0,
      rodDirection: options.launchRodDirection,
      windAverage: options.windAverage ?? 0,
      windStdDeviation: options.windStdDeviation ?? 0,
      windDirection: options.windDirection,
      windLevels: options.windLevels,
      geodetic: options.geodetic,
      launchAltitude: options.launchAltitude ?? 0,
      temperature: options.temperature,
      pressure: options.pressure,
      launchLatitude: options.launchLatitude,
      launchLongitude: options.launchLongitude,
      timeStep: options.timeStep ?? 0.05,
      maxTime: options.maxTime,
      randomSeed: options.randomSeed,
      series: options.series,
    }));
    const parsed = JSON.parse(raw) as FlightResult & { error?: string };
    if (parsed.error) {
      throw new Error(`Simulation failed: ${parsed.error}`);
    }
    return parsed;
  }
}

/** Frees all engine-side objects (all OpenRocketDesign handles become invalid). */
export function resetEngine(): void {
  eng().reset();
}
