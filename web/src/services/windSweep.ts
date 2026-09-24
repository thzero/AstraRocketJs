import type { RocketTree } from '../engine/openRocketEngine';
import type { LaunchConditions, WindLevel } from './orkTree';
import type { CompleteLaunch } from './requiredLaunch';
import { MAX_WIND_SPEED_MS, surfaceLevel } from './safetyLimits';
import { DEFAULT_HEADING_DEG, type SimInputs } from './simulations';
import { hasIntensity, stdDevForIntensity, turbulenceIntensity } from './windTurbulence';

/**
 * A batch of flights over a RANGE of wind conditions, rather than the one set
 * that was typed.
 *
 * The ground track answers "where does it come down" for the conditions in the
 * launch panel. That is the wrong question on the morning of a launch, because
 * nobody knows the wind to a tenth of a meter per second or the heading to a
 * degree: what you need is the ground the rocket could come down on across
 * everything the day might do. This is the batch that produces that, and
 * `driftEllipse.ts` turns its landings into a region.
 *
 * A GRID, not a Monte Carlo. Every flight is a named cell — this speed, that
 * heading — so the same sweep run twice gives the same picture, a landing can
 * be traced back to the conditions that produced it, and the envelope it draws
 * is a statement about the conditions actually flown rather than a sample from
 * a distribution nobody specified. It costs more flights per unit of coverage
 * than random draws; at a few dozen flights over a worker pool that is not the
 * binding constraint.
 *
 * Nothing here touches the engine. A sweep point is a set of launch conditions,
 * and the store flies them through the same `simulateInWorker` path a normal
 * run uses.
 */

/** Wrap a heading into [0, 360). */
const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

/**
 * The most flights one sweep may ask for.
 *
 * Each is a full trajectory in a worker, so an unbounded grid is an unbounded
 * wait: 6 speeds by 12 headings is 72 flights and already tens of seconds on a
 * four-worker pool. Two hundred is past anything a drift picture is improved
 * by — the envelope stops moving long before that — and it is a ceiling rather
 * than a target, so a spec that exceeds it has its heading count trimmed rather
 * than being refused.
 */
export const MAX_SWEEP_FLIGHTS = 200;

/** Bounds on each field, so a hand-built spec cannot ask for nonsense. */
const MAX_SPEED_STEPS = 12;
const MAX_HEADING_STEPS = 36;

/** One cell of the grid: the surface wind this flight is flown with. */
export interface SweepPoint {
  /** Surface wind speed, m/s. */
  speedMs: number;
  /** Surface wind heading, degrees clockwise from north. */
  headingDeg: number;
}

/**
 * What a sweep varies, and how finely.
 *
 * Speeds are absolute (m/s at the pad); headings are an ARC CENTERED on the
 * flight's own wind direction, because that is how the uncertainty is actually
 * held — "southwest, give or take" — and because a spec centered on the typed
 * heading survives changing it.
 */
export interface WindSweepSpec {
  /** Lowest surface wind to fly, m/s. */
  speedMinMs: number;
  /** Highest surface wind to fly, m/s. Capped by the safety code. */
  speedMaxMs: number;
  /** How many speeds, both ends included. 1 flies `speedMinMs` alone. */
  speedSteps: number;
  /** How many headings, spread evenly over {@link headingSpanDeg}. */
  headingSteps: number;
  /** The arc of headings to cover, degrees. 360 is the whole compass. */
  headingSpanDeg: number;
}

/** Where one flight of the sweep came down, and under what wind. */
export interface SweepLanding {
  /** Branch index, matching the ground track's own per-stage traces. */
  branch: number;
  /** Meters east of the pad. */
  east: number;
  /** Meters north of the pad. */
  north: number;
  /** The surface wind this flight was flown with, m/s. */
  speedMs: number;
  /** The surface wind heading this flight was flown with, degrees. */
  headingDeg: number;
}

/** One finished sweep: the landings, and enough context to say what they are. */
export interface DriftSweep {
  /** The simulation whose conditions the grid was built around. */
  simId: string;
  /**
   * The design it was flown on.
   *
   * Kept so an edit can make the sweep STALE rather than wrong: the landings
   * are still the honest answer for the rocket that flew them, and throwing
   * them away on the first fin tweak would mean re-flying a few dozen sims to
   * get back a picture the user was still reading. Same posture as a
   * simulation's own `outdated` flag.
   */
  tree: RocketTree;
  /**
   * The simulation's own inputs as they stood when it flew — motor, loadout,
   * ignition, launch conditions, run overrides.
   *
   * Staleness is not only about the DESIGN. Swapping the motor or moving the
   * pad changes where the rocket comes down as surely as moving a fin does, and
   * a region that quietly went on describing the old motor would be the most
   * misleading thing on the view. Compared by reference, the same test a run
   * uses (`sameSimInputs`).
   */
  inputs: SimInputs;
  spec: WindSweepSpec;
  /** How many flights the grid asked for. */
  asked: number;
  /** How many flights produced at least one landing. */
  flown: number;
  landings: SweepLanding[];
}

/**
 * Pull a spec into its legal range.
 *
 * The wind ceiling is the NAR / Tripoli one the Run button already enforces
 * (`safetyLimits.ts`): a sweep that flew past it would be drawing ground the
 * app refuses to fly to, which is worse than drawing less ground. Headings are
 * trimmed last, against {@link MAX_SWEEP_FLIGHTS}, because a coarser compass
 * loses less than a coarser speed band does — the envelope's SHAPE comes from
 * the speeds.
 */
export function normalizeSweepSpec(spec: WindSweepSpec): WindSweepSpec {
  // NaN is the only value with no order, so it is the only one that falls back
  // rather than clamping. An infinity DOES have an order and clamps to the end
  // it came from, which is the answer a reader expects: an absurdly large wind
  // is the ceiling, not still air.
  const clampInt = (v: number, lo: number, hi: number) =>
    Number.isNaN(v) ? lo : Math.max(lo, Math.min(hi, Math.round(v)));
  const clampSpeed = (v: number) => (Number.isNaN(v) ? 0 : Math.max(0, Math.min(MAX_WIND_SPEED_MS, v)));

  const a = clampSpeed(spec.speedMinMs);
  const b = clampSpeed(spec.speedMaxMs);
  const speedSteps = clampInt(spec.speedSteps, 1, MAX_SPEED_STEPS);
  const headingSpanDeg = Math.max(0, Math.min(360, Number.isFinite(spec.headingSpanDeg) ? spec.headingSpanDeg : 360));
  let headingSteps = clampInt(spec.headingSteps, 1, MAX_HEADING_STEPS);
  headingSteps = Math.max(1, Math.min(headingSteps, Math.floor(MAX_SWEEP_FLIGHTS / speedSteps)));

  return {
    // Swapped rather than rejected: "from 8 to 3" is a legible thing to type
    // into two boxes and means exactly what "from 3 to 8" means.
    speedMinMs: Math.min(a, b),
    speedMaxMs: Math.max(a, b),
    speedSteps,
    headingSteps,
    headingSpanDeg,
  };
}

/** How many flights this spec is, after normalization. */
export function sweepFlightCount(spec: WindSweepSpec): number {
  const s = normalizeSweepSpec(spec);
  return s.speedSteps * s.headingSteps;
}

/**
 * A starting grid for a given surface wind, m/s.
 *
 * Half to one-and-a-half times what was typed, over the whole compass. The band
 * is wide because a forecast's error is a fraction of the wind rather than a
 * fixed number of m/s, and the compass is whole because the direction is the
 * thing a morning forecast is least right about — a sweep that only fanned a
 * few degrees either side of the typed heading would draw an envelope whose
 * reassuring narrowness came from the assumption, not the flights.
 *
 * Still air has no fraction to take, so it gets a plain 0-4 m/s band: a light
 * breeze is what "calm" turns into by the time the rocket is on the pad.
 */
export function defaultSweepSpec(surfaceWindMs: number): WindSweepSpec {
  const base = Number.isFinite(surfaceWindMs) ? Math.max(0, surfaceWindMs) : 0;
  const hi = base > 0.5 ? base * 1.5 : 4;
  const lo = base > 0.5 ? base * 0.5 : 0;
  return normalizeSweepSpec({
    speedMinMs: lo,
    speedMaxMs: hi,
    speedSteps: 4,
    headingSteps: 8,
    headingSpanDeg: 360,
  });
}

/** The speeds this spec flies, m/s, low to high. */
export function sweepSpeeds(spec: WindSweepSpec): number[] {
  const s = normalizeSweepSpec(spec);
  if (s.speedSteps <= 1) return [s.speedMinMs];
  const step = (s.speedMaxMs - s.speedMinMs) / (s.speedSteps - 1);
  return Array.from({ length: s.speedSteps }, (_, i) => s.speedMinMs + i * step);
}

/**
 * The headings this spec flies, degrees, centered on `baseHeadingDeg`.
 *
 * A FULL compass is the wrap case and is spaced differently: eight headings
 * over 360 degrees are 45 apart with nothing at both 0 and 360, where eight
 * over a 90-degree arc are spaced to land ON both ends. Treating the whole
 * compass like an arc would fly the same heading twice and weight it double in
 * everything computed from the landings.
 */
export function sweepHeadings(spec: WindSweepSpec, baseHeadingDeg: number): number[] {
  const s = normalizeSweepSpec(spec);
  const base = Number.isFinite(baseHeadingDeg) ? baseHeadingDeg : DEFAULT_HEADING_DEG;
  if (s.headingSteps <= 1) return [norm360(base)];
  if (s.headingSpanDeg >= 360) {
    return Array.from({ length: s.headingSteps }, (_, i) => norm360(base + (i * 360) / s.headingSteps));
  }
  const start = base - s.headingSpanDeg / 2;
  const step = s.headingSpanDeg / (s.headingSteps - 1);
  return Array.from({ length: s.headingSteps }, (_, i) => norm360(start + i * step));
}

/** Every cell of the grid, speed-major so the flights arrive in a readable order. */
export function sweepPoints(spec: WindSweepSpec, baseHeadingDeg: number): SweepPoint[] {
  const out: SweepPoint[] = [];
  for (const speedMs of sweepSpeeds(spec)) {
    for (const headingDeg of sweepHeadings(spec, baseHeadingDeg)) out.push({ speedMs, headingDeg });
  }
  return out;
}

/**
 * The surface wind a launch block describes: speed and heading at the pad.
 *
 * The GROUND layer of a multilevel profile, exactly as the safety check reads
 * it, else the single wind. This is what a sweep is centered on and scaled
 * from, because it is the only wind anybody at the field can measure.
 */
export function surfaceWind(launch: LaunchConditions): SweepPoint {
  const level = surfaceLevel(launch);
  if (level) return { speedMs: level.speed, headingDeg: level.directionDeg };
  // A blank wind speed is a field the user has not filled in, not still air —
  // but this is only ever read to PROPOSE a grid or to center one, never to fly
  // anything (the run refuses an incomplete launch long before here), so a
  // blank proposes the calm-day band rather than refusing to open the panel.
  return { speedMs: launch.windAverage ?? 0, headingDeg: launch.windDirectionDeg ?? DEFAULT_HEADING_DEG };
}

/**
 * The launch conditions for one cell of the grid.
 *
 * Two rules, both of which exist so a swept flight differs from the typed one
 * in the wind and NOTHING else:
 *
 * - Turbulence keeps its INTENSITY, not its m/s. The standard deviation is a
 *   fraction of the average everywhere else in the app (`windTurbulence.ts`,
 *   and `LevelWindModel.setSpeed` in the kernel), so holding it absolute across
 *   the sweep would fly the slowest cell as a gale and the fastest as glass.
 * - A multilevel profile is SCALED AND TURNED as a whole rather than replaced.
 *   The shear a profile describes — backing 40 degrees and doubling by 300 m —
 *   is a fact about the day, not about the surface wind, and a sweep that flew
 *   the swept speed at every altitude would quietly delete it.
 *
 * A still-air surface layer has no ratio to take, so every level flies the
 * swept speed instead; there is no shear to preserve in a profile whose ground
 * layer is zero.
 */
/**
 * The standard deviation `was`/`wasStdDev` means once the average moves to `now`.
 *
 * Untouched when the old average was zero: `turbulenceIntensity` answers a flat
 * 1 there (the kernel's own stand-in for a ratio it cannot take), and putting
 * that through would turn a still-air layer carrying a whisper of scatter into
 * one whose gusts equal the whole swept wind. The same guard the wind profile
 * editor uses when a level's speed is retyped.
 */
function retune(was: number, wasStdDev: number, now: number): number {
  if (!hasIntensity(was)) return wasStdDev;
  return stdDevForIntensity(now, turbulenceIntensity(was, wasStdDev));
}

export function sweepLaunch(base: CompleteLaunch, point: SweepPoint): CompleteLaunch {
  const levels = base.windLevels;
  if (levels?.length) {
    const surface = surfaceLevel(base)!;
    const turn = point.headingDeg - surface.directionDeg;
    const ratio = hasIntensity(surface.speed) ? point.speedMs / surface.speed : null;
    const next: WindLevel[] = levels.map((l) => {
      const speed = ratio == null ? point.speedMs : l.speed * ratio;
      return {
        ...l,
        speed,
        stddev: retune(l.speed, l.stddev, speed),
        directionDeg: norm360(l.directionDeg + turn),
      };
    });
    return { ...base, windLevels: next };
  }
  return {
    ...base,
    windAverage: point.speedMs,
    windStdDev: retune(base.windAverage, base.windStdDev, point.speedMs),
    windDirectionDeg: point.headingDeg,
  };
}
