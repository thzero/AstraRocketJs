import { describe, it, expect, beforeEach, vi } from 'vitest';

// The sim normally runs in a Web Worker; stub it so the batch resolves instantly.
const simulateMock = vi.hoisted(() => vi.fn());
vi.mock('../engine/simClient', async (orig) => ({
  ...(await orig<typeof import('../engine/simClient')>()),
  simulateInWorker: simulateMock,
}));

import { useWorkspaceStore } from './store';
import { C6 } from '../engine/api';
import type { FlightResult } from '../engine/openRocketEngine';
import type { SimPrefs } from '../services/simulations';

const st = () => useWorkspaceStore.getState();

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
 * A batch reports EVERY row that did not fly, naming each one.
 *
 * Each row's `catch` used to `set({ err })` on its own, so in a batch every
 * message overwrote the one before it and none carried a row name. Then the
 * skip line, emitted once the batch drained, overwrote whatever had survived.
 * A batch with two timeouts and one row with no motor reported only the one with no motor
 * row, with nothing to say two flights had failed at all - while both failed
 * rows went red in the table with no reason attached to either.
 *
 * `runSims` already solved exactly this for SKIPS, collecting them into an
 * array and emitting one named line. The comment describing that fix sat
 * directly above the code that still had the bug for failures.
 */
describe('a batch where rows FAIL', () => {
  beforeEach(() => {
    simulateMock.mockReset();

    st().setSimsSelected([]);
    while (st().sims.length > 1) st().deleteSim(st().sims[st().sims.length - 1]!.id);
    st().renameSim(st().sims[0]!.id, 'Alpha');
    st().addSim();
    st().renameSim(st().sims[1]!.id, 'Bravo');
    st().addSim();
    st().renameSim(st().sims[2]!.id, 'Charlie');
    st().commitEdit();

    useWorkspaceStore.setState({
      sims: st().sims.map((x) => ({ ...x, motor: C6 })),
      err: null,
    });
  });

  it('names EVERY failed row, not just whichever finished last', async () => {
    // Fail all three, so the old last-writer-wins behavior is unmistakable.
    simulateMock.mockImplementation(() => Promise.reject(new Error('kernel exploded')));

    await st().runSims(
      st().sims.map((x) => x.id),
      PREFS,
    );

    const err = st().err ?? '';
    for (const name of ['Alpha', 'Bravo', 'Charlie']) expect(err).toContain(name);
    // The reason survives too, once per row rather than once for the batch.
    expect(err.match(/kernel exploded/g) ?? []).toHaveLength(3);
  });

  it('does not let the skip line erase the failures', async () => {
    // Charlie cannot fly at all (a curve-less motor is what an unresolved
    // `.ork` import leaves behind), so the skip path has something to say too.
    // That skip line used to be written over the failures, unconditionally.
    useWorkspaceStore.setState({
      sims: st().sims.map((x) =>
        x.name === 'Charlie' ? { ...x, motor: { ...C6, times: [], thrusts: [], masses: [] } } : x,
      ),
    });
    // The payload carries no row identity, so key on call order: `flying` is
    // built in target order, and with Charlie skipped that is Alpha then Bravo.
    simulateMock.mockRejectedValueOnce(new Error('boom alpha')).mockResolvedValue(RESULT);

    await st().runSims(
      st().sims.map((x) => x.id),
      PREFS,
    );

    const err = st().err ?? '';
    expect(err).toContain('Alpha'); // the failure survived the skip line...
    expect(err).toContain('boom alpha');
    expect(err).toContain('Charlie'); // ...and the skip is still reported
  });

  it('says nothing when every row flies', async () => {
    simulateMock.mockResolvedValue(RESULT);
    await st().runSims(
      st().sims.map((x) => x.id),
      PREFS,
    );
    expect(st().err).toBeNull();
  });
});
