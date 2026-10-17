import { describe, it, expect, beforeEach, vi } from 'vitest';

// The sim normally runs in a Web Worker; stub it so the batch resolves instantly.
const simulateMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/engine/simClient', async (orig) => ({
  ...(await orig<typeof import('../../src/engine/simClient')>()),
  simulateInWorker: simulateMock,
}));

import { useWorkspaceStore } from '../../src/state/store';
import i18n from '../../src/i18n';
import { KeyedError } from '../../src/i18n/keyedError';
import { seatMotor, CURVELESS } from '../testing/seatMotor';
import type { FlightResult } from '../../src/engine/openRocketEngine';
import type { SimPrefs } from '../../src/services/flight/simulations';

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

// The runs fly the globals the store mirrors, so the mirror holds PREFS.
beforeEach(() => st().setSimPrefs(PREFS));

const RESULT = { summary: { maxAltitude: 100 }, events: [], series: {} } as unknown as FlightResult;

/**
 * A batch reports every row that did not fly, naming each one.
 *
 * A per-row `set({ err })` would leave only the last message, with no row name
 * on it, and the skip line written once the batch drains would overwrite it: two
 * timeouts and a row with no motor would report only the missing motor.
 * Failures are collected and written as one named line beside the skips.
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

    useWorkspaceStore.setState({ err: null });
  });

  it('names EVERY failed row, not just whichever finished last', async () => {
    // Fail all three, so a last-writer-wins report is unmistakable.
    simulateMock.mockImplementation(() => Promise.reject(new Error('kernel exploded')));

    await st().runSims(st().sims.map((x) => x.id));

    const err = st().err ?? '';
    for (const name of ['Alpha', 'Bravo', 'Charlie']) expect(err).toContain(name);
    // The reason survives too, once per row rather than once for the batch.
    expect(err.match(/kernel exploded/g) ?? []).toHaveLength(3);
  });

  it('does not let the skip line erase the failures', async () => {
    // Charlie cannot fly at all (a curve-less motor is what an unresolved
    // `.ork` import leaves behind), so the skip path has something to say too.
    // Its line must not be written over the failures.
    seatMotor('Charlie', CURVELESS);
    // The payload carries no row identity, so key on call order: `flying` is
    // built in target order, and with Charlie skipped that is Alpha then Bravo.
    simulateMock.mockRejectedValueOnce(new Error('boom alpha')).mockResolvedValue(RESULT);

    await st().runSims(st().sims.map((x) => x.id));

    const err = st().err ?? '';
    expect(err).toContain('Alpha'); // the failure survived the skip line...
    expect(err).toContain('boom alpha');
    expect(err).toContain('Charlie'); // ...and the skip is still reported
  });

  it("gives a keyed failure from the worker in the app's language", async () => {
    await i18n.changeLanguage('de');
    try {
      simulateMock.mockImplementation(() =>
        Promise.reject(new KeyedError('errors.motorCurve.noMass', { motor: 'F67' })),
      );
      await st().runSims([st().sims[0]!.id]);
      const err = st().err ?? '';
      expect(err).toContain(i18n.t('errors.motorCurve.noMass', { motor: 'F67' }));
      expect(err).not.toContain('thrust curve');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('says nothing when every row flies', async () => {
    simulateMock.mockResolvedValue(RESULT);
    await st().runSims(st().sims.map((x) => x.id));
    expect(st().err).toBeNull();
  });
});
