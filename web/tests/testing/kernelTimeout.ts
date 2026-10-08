/**
 * The timeout for a test file that flies the real kernel.
 *
 * Every test file that loads the engine imports it (`engineBoundary`,
 * `rodClearanceModel`, `exampleLibrary` and the `*.kernel.test.ts` files among
 * them). Each loads the 2.9 MB TeaVM bundle and integrates real trajectories, so
 * each takes seconds where most files take milliseconds. This is the reason and
 * the number in one place.
 *
 * ## Why not 60 seconds
 *
 * `rodClearanceModel.test.ts` flies eleven trajectories and takes about 55 s alone
 * on an idle machine. Against a 60 s cap that is under 10% headroom, and machine
 * load (another vitest process, a coverage run, a shared CI runner) easily takes
 * more than that. The cap has to be sized to the variance, not to the work.
 *
 * A timeout here is not a flaky test in isolation either: vitest writes no
 * `coverage-summary.json` when the suite fails, so `gates.yml` falls into its
 * "the suite did not finish" branch and the run reports no coverage at all.
 *
 * ## Why this number
 *
 * Three times the slowest measured file. A timeout exists to catch a hang, and
 * three minutes catches a hang just as well as one does: a kernel that has
 * deadlocked is not going to finish in 170 s. What it stops catching is a loaded
 * runner, which is not worth failing a build over.
 *
 * ## Still opted into per file
 *
 * Imported where it is needed, not set globally. Off CI the default stays at
 * vitest's 5 s so a test that starts taking seconds is noticed locally; on CI
 * vitest.config.ts raises the default to a minute for runner load, which is
 * still short of what these files need.
 */
export const KERNEL_TEST_TIMEOUT_MS = 180_000;
