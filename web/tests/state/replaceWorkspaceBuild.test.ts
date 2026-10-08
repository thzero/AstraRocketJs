import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../../src/state/store';
import type { StaticInfo } from '../../src/engine/openRocketEngine';

/**
 * A new design must not show the old design's numbers, even for one frame.
 *
 * `replaceWorkspace` clears `info` and `rocket` with the other transient fields,
 * because they describe the design on its way out. The rebuild effect replaces
 * them only on its next run, so left in place, a brand-new blank design would show
 * the previous design's mass, CG and stability margin for one frame, in the stats
 * panel, which is the first thing you look at.
 *
 * Cleared to `null`, which is the same state the rebuild effect uses for "not
 * built yet" (`applyBuild(null, null)`), so the panel reads as pending rather than
 * as someone else's rocket.
 */
const s = () => useWorkspaceStore.getState();

/** A stand-in build: only its identity matters here. */
const build = (mass: number) => ({
  info: { mass } as unknown as StaticInfo,
  // The handle type is local to the store (`ReturnType<typeof buildRocketTree>`);
  // nothing here calls it, only checks whether it is still there.
  rocket: {} as never,
});

describe('replaceWorkspace clears the live build', () => {
  beforeEach(() => {
    s().resetWorkspace();
  });

  it('drops the outgoing info and handle', () => {
    const b = build(1.234);
    s().applyBuild(b.info, b.rocket);
    expect(s().info).not.toBeNull();

    s().resetWorkspace();
    expect(s().info).toBeNull();
    expect(s().rocket).toBeNull();
  });

  it('does not leak the old mass into the new design', () => {
    s().applyBuild(build(99).info, build(99).rocket);
    s().resetWorkspace();
    // The specific reading: not 99, and not a stale object either.
    expect((s().info as { mass?: number } | null)?.mass).toBeUndefined();
  });

  it('still clears everything it cleared before', () => {
    // The guard against "fixed by deleting the rest of the reset".
    s().applyBuild(build(1).info, build(1).rocket);
    s().resetWorkspace();
    expect(s().simRuns).toEqual({});
    expect(s().lastRunIds).toEqual([]);
    expect(s().resultSimId).toBeNull();
    expect(s().selectedSimIds).toEqual([]);
    expect(s().simBusy).toBe(false);
    expect(s().driftSweep).toBeNull();
    expect(s().driftSweepRun).toBeNull();
    expect(s().err).toBeNull();
  });
});
