import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../../../src/state/store';
import { landingView, planRun, runProblems } from '../../../src/services/flight/runPlan';
import { newFlightConfig } from '../../../src/services/flight/flightConfigs';
import type { Simulation } from '../../../src/services/flight/simulations';
import { unitSymbols } from '../../../src/prefs/units';
import { DEFAULT_SETTINGS } from '../../../src/services/storage/settings';

/**
 * The decisions a batch run makes, tested as plain data. The store's default
 * workspace is only the fixture: a design with a mount and a seated motor, and
 * one simulation that can fly it.
 */

const st = () => useWorkspaceStore.getState();
const t = (key: string, vars?: Record<string, unknown>) => `${key}${vars ? JSON.stringify(vars) : ''}`;
const units = unitSymbols(DEFAULT_SETTINGS.units, DEFAULT_SETTINGS.unitOverrides);

beforeEach(() => st().resetWorkspace());

const row = (over: Partial<Simulation>): Simulation => ({ ...st().sims[0]!, ...over });

describe('planRun', () => {
  it('flies a row that can fly', () => {
    const sim = st().sims[0]!;
    const plan = planRun([sim.id], st().sims, st().tree, st().configs);
    expect(plan.blocker).toBeNull();
    expect(plan.flying.map((f) => f.sim.id)).toEqual([sim.id]);
    expect(plan.skipped).toEqual([]);
    expect(plan.failedIds).toEqual([]);
  });

  it('drops ids that name no row', () => {
    const plan = planRun(['nobody'], st().sims, st().tree, st().configs);
    expect(plan.flying).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.failedIds).toEqual([]);
  });

  it('skips a row with no usable motor, names it, and records it as failed', () => {
    const empty = newFlightConfig({});
    const bare = row({ id: 'bare', name: 'Bare', configId: empty.id });
    const plan = planRun(['bare'], [bare], st().tree, [...st().configs, empty]);
    expect(plan.flying).toEqual([]);
    expect(plan.skipped).toEqual([{ id: 'bare', name: 'Bare', reason: { kind: 'noMotor' } }]);
    expect(plan.failedIds).toEqual(['bare']);
  });

  it('skips a row whose launch is outside the safety codes', () => {
    const steep = row({ id: 'steep', name: 'Steep', launch: { ...st().sims[0]!.launch, launchRodAngleDeg: 45 } });
    const plan = planRun(['steep'], [steep], st().tree, st().configs);
    expect(plan.skipped.map((u) => [u.id, u.reason.kind])).toEqual([['steep', 'limits']]);
  });

  it('flies the good rows of a mixed batch, in the order asked', () => {
    const good = row({ id: 'good', name: 'Good' });
    const also = row({ id: 'also', name: 'Also' });
    const steep = row({ id: 'steep', name: 'Steep', launch: { ...st().sims[0]!.launch, launchRodAngleDeg: 45 } });
    const plan = planRun(['also', 'steep', 'good'], [good, also, steep], st().tree, st().configs);
    expect(plan.flying.map((f) => f.sim.id)).toEqual(['also', 'good']);
    expect(plan.failedIds).toEqual(['steep']);
  });

  it('flies nothing on a blocked design, and records every requested row as failed', () => {
    const blocked = { ...st().tree, components: [] };
    const good = row({ id: 'good', name: 'Good' });
    const plan = planRun(['good', 'nobody'], [good], blocked, st().configs);
    expect(plan.blocker).not.toBeNull();
    expect(plan.flying).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.failedIds).toEqual(['good']);
  });
});

describe('runProblems', () => {
  it('lists refusals first, then failures, each naming its row', () => {
    const lines = runProblems(
      [{ id: 'a', name: 'A', reason: { kind: 'noMotor' } }],
      [{ name: 'B', msg: 'timed out' }],
      t,
      units,
    );
    expect(lines).toEqual(['sim.noMotorNamed{"name":"A"}', 'sim.failedNamed{"name":"B","message":"timed out"}']);
  });

  it('is empty when everything flew', () => {
    expect(runProblems([], [], t, units)).toEqual([]);
  });
});

describe('landingView', () => {
  it('opens the active row when it is one that landed', () => {
    expect(landingView(['a', 'b'], 'b')).toEqual({ lastRunIds: ['a', 'b'], resultSimId: 'b' });
  });

  it('opens the first that landed when the active row did not fly', () => {
    expect(landingView(['a', 'b'], 'z')).toEqual({ lastRunIds: ['a', 'b'], resultSimId: 'a' });
  });

  it('shows nothing when nothing landed', () => {
    expect(landingView([], 'a')).toBeNull();
  });
});
