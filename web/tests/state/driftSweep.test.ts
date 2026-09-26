import { describe, it, expect, beforeEach, vi } from 'vitest';

// The sweep flies through the same worker pool a normal batch does; stub it so
// each cell can be settled by hand and its payload inspected.
const simulateMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/engine/simClient', async (orig) => ({
  ...(await orig<typeof import('../../src/engine/simClient')>()),
  simulateInWorker: simulateMock,
}));

import { useWorkspaceStore } from '../../src/state/store';
import { C6 } from '../../src/engine/api';
import type { SimPrefs } from '../../src/services/simulations';
import type { FlightResult } from '../../src/engine/openRocketEngine';
import type { SimPayload } from '../../src/engine/simProtocol';
import type { SimCallOptions } from '../../src/engine/simClient';
import { normalizeSweepSpec, type WindSweepSpec } from '../../src/services/windSweep';

const st = () => useWorkspaceStore.getState();

const PREFS = {
  timeStep: 0.05,
  maxTime: 1200,
  maxAngleStep: (3 * Math.PI) / 180,
  randomSeed: null,
  deploymentSpeedWarn: 20,
  mainHighSpeedWarn: 30.48,
  mainLowSpeedWarn: 15.24,
  drogueLowSpeedWarn: 3.048,
} as SimPrefs;

/** A 2 x 2 grid: four flights, which is enough to have a region and stay readable. */
const SPEC: WindSweepSpec = normalizeSweepSpec({
  speedMinMs: 2,
  speedMaxMs: 6,
  speedSteps: 2,
  headingSteps: 2,
  headingSpanDeg: 360,
});

/** A flight that came down at (east, north). */
const landed = (east: number, north: number) =>
  ({
    summary: {},
    events: [],
    series: { time: [0, 1], Px: [0, east], Py: [0, north] },
  }) as unknown as FlightResult;

/**
 * A wind sweep, from the store down to the landings it keeps.
 *
 * What is being pinned here is the contract the ground track draws from: every
 * cell flies the SAME rocket under a DIFFERENT wind, the row's own result is
 * never touched, and a part-flown grid is thrown away rather than drawn as if
 * it were whole.
 */
describe('a drift sweep', () => {
  let calls: { payload: SimPayload; opts: SimCallOptions; settle: (r: FlightResult) => void }[];

  beforeEach(() => {
    calls = [];
    simulateMock.mockReset();
    simulateMock.mockImplementation(
      (payload: SimPayload, opts: SimCallOptions = {}) =>
        new Promise<FlightResult>((resolve) => {
          calls.push({ payload, opts, settle: resolve });
        }),
    );
    while (st().sims.length > 1) st().deleteSim(st().sims[st().sims.length - 1]!.id);
    useWorkspaceStore.setState({
      sims: st().sims.map((x) => ({ ...x, motor: C6, result: null, outdated: false })),
      driftSweep: null,
      driftSweepRun: null,
      err: null,
    });
  });

  const simId = () => st().sims[0]!.id;
  const start = (spec = SPEC) => {
    const done = st().runDriftSweep(simId(), spec, PREFS);
    return done;
  };

  it('submits one flight per cell of the grid, all at once', async () => {
    const done = start();
    expect(calls).toHaveLength(4);
    expect(st().driftSweepRun).toEqual({ simId: simId(), done: 0, total: 4 });
    calls.forEach((c, i) => c.settle(landed(10 * (i + 1), 0)));
    await done;
    expect(st().driftSweep?.landings).toHaveLength(4);
    expect(st().driftSweepRun).toBeNull();
  });

  /**
   * The wind is the ONLY thing that moves. Everything else differing per cell
   * would make the spread unattributable, which is the whole value of a grid
   * over a handful of ad-hoc runs.
   */
  it('varies the wind and nothing else', async () => {
    const done = start();
    const winds = calls.map((c) => [c.payload.options.windAverage, c.payload.options.windDirection]);
    expect(new Set(winds.map((w) => String(w))).size).toBe(4);
    expect(new Set(calls.map((c) => c.payload.motor)).size).toBe(1);
    expect(new Set(calls.map((c) => c.payload.tree)).size).toBe(1);
    expect(new Set(calls.map((c) => c.payload.options.launchRodAngle)).size).toBe(1);
    calls.forEach((c) => c.settle(landed(1, 1)));
    await done;
  });

  /** One seed for the grid, so the scatter drawn is the wind's and not the dice's. */
  it('pins one turbulence seed across every cell', async () => {
    const done = start();
    expect(new Set(calls.map((c) => c.payload.options.randomSeed)).size).toBe(1);
    calls.forEach((c) => c.settle(landed(1, 1)));
    await done;
  });

  /** Only the end of the track is read, and a full series set is ~1.5 MB a flight. */
  it('asks for summary series, not every series the kernel holds', async () => {
    const done = start();
    expect(calls.every((c) => c.payload.options.series === 'summary')).toBe(true);
    calls.forEach((c) => c.settle(landed(1, 1)));
    await done;
  });

  it('leaves the simulation own result alone', async () => {
    const done = start();
    calls.forEach((c) => c.settle(landed(5, 5)));
    await done;
    expect(st().sims[0]!.result).toBeNull();
  });

  it('keeps each landing with the wind that produced it', async () => {
    const done = start();
    calls.forEach((c, i) => c.settle(landed(i, 0)));
    await done;
    for (const l of st().driftSweep!.landings) {
      expect(l.speedMs).toBeGreaterThanOrEqual(2);
      expect(l.speedMs).toBeLessThanOrEqual(6);
      expect(l.headingDeg).toBeGreaterThanOrEqual(0);
      expect(l.headingDeg).toBeLessThan(360);
    }
  });

  /**
   * A staged flight lands twice, and the two landings belong to different
   * traces on the plan view — a spent booster comes down nowhere near the
   * sustainer, so merging them would draw one envelope around both.
   */
  it('files a staged flight landings under their own branches', async () => {
    const done = start();
    const staged = {
      summary: {},
      events: [],
      series: {},
      branches: [{ series: { Px: [0, 100], Py: [0, 0] } }, { series: { Px: [0, -50], Py: [0, 20] } }],
    } as unknown as FlightResult;
    calls.forEach((c) => c.settle(staged));
    await done;
    const branches = st().driftSweep!.landings.map((l) => l.branch);
    expect(branches.filter((b) => b === 0)).toHaveLength(4);
    expect(branches.filter((b) => b === 1)).toHaveLength(4);
  });

  /**
   * Cells arrive in whatever order the pool frees up, so what survives a cancel
   * is an arbitrary subset of the conditions. A hull round that understates the
   * drift by an amount nobody could estimate.
   */
  it('keeps nothing from a canceled sweep', async () => {
    const done = start();
    calls[0]!.settle(landed(10, 10));
    st().cancelDriftSweep();
    calls.slice(1).forEach((c) => c.settle(landed(10, 10)));
    await done;
    expect(st().driftSweep).toBeNull();
    expect(st().driftSweepRun).toBeNull();
  });

  it('counts the flights that landed, not the ones that were asked for', async () => {
    const done = start();
    calls[0]!.settle({ summary: {}, events: [], series: {} } as unknown as FlightResult);
    calls.slice(1).forEach((c) => c.settle(landed(3, 4)));
    await done;
    expect(st().driftSweep).toMatchObject({ asked: 4, flown: 3 });
    expect(st().driftSweep!.landings).toHaveLength(3);
  });

  it('says so when no flight came down anywhere', async () => {
    const done = start();
    calls.forEach((c) => c.settle({ summary: {}, events: [], series: {} } as unknown as FlightResult));
    await done;
    expect(st().driftSweep).toBeNull();
    expect(st().err).toBeTruthy();
  });

  it('refuses a simulation with no usable motor, without flying anything', async () => {
    useWorkspaceStore.setState({
      sims: st().sims.map((x) => ({ ...x, motor: { ...C6, times: [], thrusts: [], masses: [] } })),
    });
    await start();
    expect(calls).toHaveLength(0);
    expect(st().err).toBeTruthy();
  });

  /**
   * Nothing gates a second sweep on the first draining, so the stragglers of
   * the one being replaced must not tick the new one's counter — least of all
   * when it is the same row being swept again.
   */
  it('does not let a superseded sweep count against its replacement', async () => {
    const first = start();
    const stragglers = calls.slice();
    const second = start();
    const fresh = calls.slice(stragglers.length);
    stragglers.forEach((c) => c.settle(landed(1, 1)));
    await first;
    expect(st().driftSweepRun).toMatchObject({ done: 0, total: 4 });
    fresh.forEach((c) => c.settle(landed(2, 2)));
    await second;
    expect(st().driftSweep!.asked).toBe(4);
    expect(st().driftSweep!.flown).toBe(4);
  });

  it('records the design it flew, so a later edit can age it', async () => {
    const done = start();
    calls.forEach((c) => c.settle(landed(1, 1)));
    await done;
    expect(st().driftSweep!.tree).toBe(st().tree);
  });
});
