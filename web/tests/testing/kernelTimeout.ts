/**
 * The timeout for a test file that flies the REAL kernel.
 *
 * Four files do: `engineBoundary`, `rodClearanceModel`, `loadOrk.unbuildable` and
 * `exampleLibrary`. Each loads the 2.9 MB TeaVM bundle and integrates real
 * trajectories, so each takes seconds where the other 255 files take
 * milliseconds. All four used to spell `60_000` with a paragraph apiece saying
 * why; this is that paragraph once, and the number in one place.
 *
 * ## Why not 60 seconds
 *
 * `rodClearanceModel.test.ts` flies eleven trajectories and takes **54.6 s alone
 * on an idle machine**. Against a 60 s cap that is under 10% headroom, and it has
 * been spent twice: once with audit agents competing for the machine (one case
 * reported 93.6 s, the file 465 s) and once under `npm run test:coverage` with
 * another vitest process running (the suite took 520 s against its usual 65 s).
 *
 * Neither failure was a hang, and neither says anything about CI on its own. What
 * they say together is that the cap was sized to the work rather than to the
 * variance, and the variance here is machine load, which a shared CI runner has
 * plenty of. The consequence is not a flaky test in isolation either: vitest
 * writes no `coverage-summary.json` when the suite fails, so `gates.yml` falls
 * into its "the suite did not finish" branch and the run reports no coverage at
 * all.
 *
 * ## Why this number
 *
 * Three times the slowest measured file. A timeout exists to catch a HANG, and
 * three minutes catches a hang just as well as one does - a kernel that has
 * deadlocked is not going to finish in 170 s. What it stops catching is a loaded
 * runner, which was never the thing worth failing a build over.
 *
 * ## Still opted into per file
 *
 * Imported where it is needed, not set globally. Off CI the default stays at
 * vitest's 5 s so a test that starts taking seconds is noticed locally; on CI
 * vitest.config.ts raises the default to a minute for runner load, which is
 * still short of what these files need.
 */
export const KERNEL_TEST_TIMEOUT_MS = 180_000;
