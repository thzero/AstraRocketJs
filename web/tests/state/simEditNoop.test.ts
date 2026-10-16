import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore, selectActive } from '../../src/state/store';

/**
 * A write that leaves the state saying what it already says is not an edit:
 * it records no undo step, keeps the redo stack, and keeps the same simulation
 * and configuration objects, so a run in flight is not dropped as outdated.
 */
const s = () => useWorkspaceStore.getState();

/** One real edit, committed and undone, so there is something on the redo stack. */
const withRedo = (edit: () => void) => {
  edit();
  s().commitEdit();
  s().undo();
  expect(s().future).toHaveLength(1);
};

const expectNoStep = (before: { past: number; future: number }) => {
  s().commitEdit();
  expect(s().past).toHaveLength(before.past);
  expect(s().future).toHaveLength(before.future);
};

const counts = () => ({ past: s().past.length, future: s().future.length });

describe('a write that changes nothing records no undo step', () => {
  beforeEach(() => {
    s().resetWorkspace();
  });

  it('setDeployment to the value already overridden, or clearing one not set', () => {
    const configId = s().configs[0]!.id;
    s().setDeployment(configId, 'chute', 'deployAltitude', 150);
    s().commitEdit();
    withRedo(() => s().setDeployment(configId, 'chute', 'deployDelay', 2));
    const configs = s().configs;
    const before = counts();
    s().setDeployment(configId, 'chute', 'deployAltitude', 150);
    s().setDeployment(configId, 'chute', 'deployDelay', null);
    expectNoStep(before);
    expect(s().configs).toBe(configs);
  });

  it('setSeparation to the value already overridden', () => {
    const configId = s().configs[0]!.id;
    s().setSeparation(configId, 'booster', 'separationDelay', 1);
    s().commitEdit();
    withRedo(() => s().setSeparation(configId, 'booster', 'separationDelay', 3));
    const configs = s().configs;
    const before = counts();
    s().setSeparation(configId, 'booster', 'separationDelay', 1);
    s().setSeparation(configId, 'booster', 'separationAltitude', null);
    expectNoStep(before);
    expect(s().configs).toBe(configs);
  });

  it('patchLaunch with the launch conditions the row already has', () => {
    const angle = selectActive(s()).launch.launchRodAngleDeg;
    withRedo(() => s().patchLaunch({ launchRodAngleDeg: (angle ?? 0) + 1 }));
    const sim = selectActive(s());
    const before = counts();
    s().patchLaunch({ launchRodAngleDeg: angle });
    s().patchLaunch((l) => ({ launchRodAngleDeg: l.launchRodAngleDeg }));
    expectNoStep(before);
    expect(selectActive(s())).toBe(sim);
  });

  it('renameSim to the name it has', () => {
    const { id, name } = selectActive(s());
    withRedo(() => s().renameSim(id, `${name} 2`));
    const sim = selectActive(s());
    const before = counts();
    s().renameSim(id, name);
    expectNoStep(before);
    expect(selectActive(s())).toBe(sim);
  });

  it('setSimPref to the override already set, or clearing one not set', () => {
    s().setSimPref('timeStep', 0.01);
    s().commitEdit();
    withRedo(() => s().setSimPref('maxTime', 300));
    const sim = selectActive(s());
    const before = counts();
    s().setSimPref('timeStep', 0.01);
    s().setSimPref('maxTime', null);
    expectNoStep(before);
    expect(selectActive(s())).toBe(sim);
  });

  it('still records a real change', () => {
    const before = counts();
    s().setSimPref('timeStep', 0.02);
    s().commitEdit();
    expect(s().past).toHaveLength(before.past + 1);
  });
});
