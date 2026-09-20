import { useEffect, useMemo, useState } from 'react';
import type { AeroSweep, OpenRocketDesign } from '../../engine/openRocketEngine';

/**
 * The deferred aero sweep behind AeroAnalysis. Owns WHEN the kernel's
 * `aeroSweep` runs and what the pane shows while it does; nothing here draws.
 *
 * The sweep runs from an EFFECT into state, not inside a render-time memo.
 * `rocket.aeroSweep` is a synchronous kernel call (48-50 samples with a full
 * per-component force analysis) that used to run in the render body, so
 * every input change stalled the render with no busy state and nothing on
 * screen could respond until it returned. Deferring it one macrotask lets
 * the render that shows `pending` paint first: the previous chart stays up
 * and interactive, the header shows it is computing, and a stale run (the
 * inputs changed again before it started) is skipped rather than displayed.
 */

/** The flight conditions and Mach range one sweep is flown at. */
export interface AeroSweepInputs {
  machMax: number;
  aoaDeg: number;
  thetaDeg: number;
  rollRate: number;
}

/** What the hook needs of the engine handle; the store's `rocket` satisfies it. */
type SweepSource = Pick<OpenRocketDesign, 'aeroSweep'>;

/** One run's inputs, as one object: its identity is what a result is filed under. */
type Run = AeroSweepInputs & { rocket: SweepSource | null };

/**
 * How long the sweep effect waits before calling the kernel. Zero is enough:
 * a macrotask lets the render that showed `pending` (with the previous chart
 * still up and interactive) paint first, and the effect's cleanup cancels a
 * run whose inputs changed before it started.
 */
const SWEEP_DEFER_MS = 0;

export function useAeroSweep(
  rocket: SweepSource | null,
  { machMax, aoaDeg, thetaDeg, rollRate }: AeroSweepInputs,
): { sweep: AeroSweep | null; pending: boolean } {
  // One object per distinct set of inputs. The result is filed under the run
  // it answers, so `pending` is DERIVED (the latest result is not for this
  // run) rather than a flag the effect sets on entry. The flag version was a
  // synchronous setState at the top of the effect, which is a cascading
  // render the compiler lint rejects, and it was also one more thing that
  // could drift from the truth it summarized.
  const run = useMemo<Run>(
    () => ({ rocket, machMax, aoaDeg, thetaDeg, rollRate }),
    [rocket, machMax, aoaDeg, thetaDeg, rollRate],
  );
  const [done, setDone] = useState<{ sweep: AeroSweep | null; run: Run | null }>({ sweep: null, run: null });

  useEffect(() => {
    let canceled = false;
    const id = setTimeout(() => {
      if (canceled) return;
      let next: AeroSweep | null = null;
      if (run.rocket) {
        try {
          // Finer steps over a shorter sweep: M1 at 0.02 is 48 samples, fewer than
          // the 59 the old M3 default already asked for, and it puts the resolution
          // where a subsonic rocket's drag actually moves - the rise from ~0.8.
          const machStep = run.machMax <= 1 ? 0.02 : run.machMax > 3 ? 0.1 : 0.05;
          next = run.rocket.aeroSweep({
            machMin: 0.05,
            machMax: run.machMax,
            machStep,
            aoaDeg: run.aoaDeg,
            thetaDeg: run.thetaDeg,
            rollRate: run.rollRate,
          });
        } catch (e) {
          // Was a silent catch: a kernel that throws here left the pane on its
          // "build a valid rocket" prompt with nothing anywhere saying why.
          console.error('aeroSweep failed', e);
        }
      }
      if (!canceled) setDone({ sweep: next, run });
    }, SWEEP_DEFER_MS);
    return () => {
      canceled = true;
      clearTimeout(id);
    };
  }, [run]);

  // With no rocket there is nothing to compute and nothing to show, whatever
  // the last result was; with one, the previous sweep stays up until the
  // current run lands.
  return { sweep: rocket ? done.sweep : null, pending: !!rocket && done.run !== run };
}
