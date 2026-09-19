import { describe, it, expect, beforeEach, vi } from 'vitest';

// The sim normally runs in a Web Worker; stub it so the batch resolves instantly.
const simulateMock = vi.hoisted(() => vi.fn());
vi.mock('../engine/simClient', async (orig) => ({
  ...(await orig<typeof import('../engine/simClient')>()),
  simulateInWorker: simulateMock,
}));

import { useWorkspaceStore } from './store';
import { C6 } from '../engine/api';
import { MAX_WIND_SPEED_MS } from '../services/safetyLimits';
import type { FlightResult } from '../engine/openRocketEngine';
import type { SimPrefs } from '../services/simulations';

const st = () => useWorkspaceStore.getState();
const byName = (n: string) => st().sims.find((x) => x.name === n)!;

const PREFS = {
  timeStep: 0.05,
  maxTime: 1200,
  maxAngleStep: (3 * Math.PI) / 180,
  randomSeed: 1,
  deploymentSpeedWarn: 20,
  mainHighSpeedWarn: 30.48,
  mainLowSpeedWarn: 15.24,
  drogueLowSpeedWarn: 3.048,
} as SimPrefs;

const RESULT = { summary: { maxAltitude: 100 }, events: [], series: {} } as unknown as FlightResult;

/**
 * One unflyable row must not cost the rest of the batch.
 *
 * The Run button and the run loop used to judge this differently: the button
 * checked the ACTIVE simulation's motor (and only for a single run), while it
 * blocked the WHOLE batch if any row broke the safety codes. So a batch could
 * be vetoed over one bad row, or started with an unflyable row the button never
 * mentioned. Both now ask `services/runnability`.
 */
describe('a batch with an unflyable row', () => {
  beforeEach(async () => {
    simulateMock.mockReset();
    simulateMock.mockResolvedValue(RESULT);

    st().setSimsSelected([]);
    while (st().sims.length > 1) st().deleteSim(st().sims[st().sims.length - 1]!.id);
    st().renameSim(st().sims[0]!.id, 'Good');
    st().addSim();
    st().renameSim(st().sims[1]!.id, 'NoMotor');
    st().addSim();
    st().renameSim(st().sims[2]!.id, 'TooWindy');
    st().commitEdit();

    // A curve-less motor is exactly what an unresolved .ork import leaves behind.
    useWorkspaceStore.setState({
      sims: st().sims.map((x) =>
        x.name === 'NoMotor'
          ? { ...x, motor: { ...C6, times: [], thrusts: [], masses: [] } }
          : x.name === 'TooWindy'
            ? { ...x, launch: { ...x.launch, windAverage: MAX_WIND_SPEED_MS + 5 } }
            : { ...x, motor: C6 },
      ),
      err: null,
    });
  });

  it('flies the good row and skips the other two', async () => {
    const ids = st().sims.map((x) => x.id);
    await st().runSims(ids, PREFS);

    expect(simulateMock).toHaveBeenCalledTimes(1);
    expect(byName('Good').result).toBeTruthy();
    expect(byName('NoMotor').result).toBeNull();
    expect(byName('TooWindy').result).toBeNull();
  });

  it('reports BOTH skipped rows, naming each', async () => {
    // Each skip used to set `err` on its own, so the last one overwrote the
    // first and the message carried no name at all.
    await st().runSims(
      st().sims.map((x) => x.id),
      PREFS,
    );
    const err = st().err ?? '';
    expect(err).toContain('NoMotor');
    expect(err).toContain('TooWindy');
  });

  it('refuses the whole batch when the DESIGN has a zeroed dimension', async () => {
    // Every row shares the tree, so there is no good row to let through. This
    // used to fly and hand back an apogee for a zero-volume body tube.
    const tree = st().tree;
    const zeroed = structuredClone(tree);
    const walk = (n: { type?: string; outerRadius?: number; children?: unknown[] }) => {
      if (n.type === 'bodytube') n.outerRadius = 0;
      for (const c of (n.children ?? []) as (typeof n)[]) walk(c);
    };
    for (const c of zeroed.components as unknown as Parameters<typeof walk>[0][]) walk(c);
    useWorkspaceStore.setState({ tree: zeroed, err: null });

    await st().runSims(
      st().sims.map((x) => x.id),
      PREFS,
    );
    expect(simulateMock).not.toHaveBeenCalled();
    expect(st().err ?? '').toMatch(/radius|dimension|zero/i);

    useWorkspaceStore.setState({ tree });
  });

  it('still flies a lone good row when it is the only one selected', async () => {
    await st().runSims([byName('Good').id], PREFS);
    expect(simulateMock).toHaveBeenCalledTimes(1);
    expect(st().err).toBeNull();
  });

  it('flies nothing and says why when every selected row is unflyable', async () => {
    await st().runSims([byName('NoMotor').id, byName('TooWindy').id], PREFS);
    expect(simulateMock).not.toHaveBeenCalled();
    expect(st().err ?? '').toContain('NoMotor');
  });
});
