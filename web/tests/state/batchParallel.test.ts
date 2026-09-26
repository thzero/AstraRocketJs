import { describe, it, expect, beforeEach, vi } from 'vitest';

// The sim normally runs in a Web Worker pool; stub the client so each call can
// be held open and released by hand, which is the only way to observe that a
// batch is in flight ALL AT ONCE rather than one row after another.
const simulateMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/engine/simClient', async (orig) => ({
  ...(await orig<typeof import('../../src/engine/simClient')>()),
  simulateInWorker: simulateMock,
}));

import { useWorkspaceStore } from '../../src/state/store';
import { C6 } from '../../src/engine/api';
import { simStatus, type SimPrefs } from '../../src/services/simulations';
import type { FlightResult } from '../../src/engine/openRocketEngine';
// The real class (the mock spreads the actual module), so the store's
// `instanceof SimCanceledError` check sees the same identity it would in the app.
import { SimCanceledError } from '../../src/engine/simClient';
import type { SimCallOptions } from '../../src/engine/simClient';
import type { SimPayload } from '../../src/engine/simProtocol';

const st = () => useWorkspaceStore.getState();
const byName = (n: string) => st().sims.find((x) => x.name === n)!;
const statusOf = (n: string) => simStatus(byName(n), st().simRuns, st().tree);

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

const result = (apogee: number) =>
  ({ summary: { maxAltitude: apogee }, events: [], series: {} }) as unknown as FlightResult;

/** One held-open sim call: its options (for onStart) and its settle handles. */
interface Call {
  opts: SimCallOptions;
  resolve: (r: FlightResult) => void;
  reject: (e: Error) => void;
}

/**
 * The batch runs every row CONCURRENTLY.
 *
 * It used to `await` each sim inside a `for` loop, because there was one worker
 * holding one engine and firing several only queued them behind each other.
 * With a pool of workers the loop was the bottleneck, so these assert the store
 * actually submits them all and lets the transport decide how many fly at once.
 */
describe('a batch over the worker pool', () => {
  let calls: Call[];

  beforeEach(() => {
    calls = [];
    simulateMock.mockReset();
    // Never settles on its own: the test decides when each flight lands.
    simulateMock.mockImplementation((_p: SimPayload, opts: SimCallOptions = {}) => {
      return new Promise<FlightResult>((resolve, reject) => {
        calls.push({ opts, resolve, reject });
      });
    });

    st().setSimsSelected([]);
    while (st().sims.length > 1) st().deleteSim(st().sims[st().sims.length - 1]!.id);
    st().renameSim(st().sims[0]!.id, 'A');
    st().addSim();
    st().renameSim(st().sims[1]!.id, 'B');
    st().addSim();
    st().renameSim(st().sims[2]!.id, 'C');
    st().commitEdit();
    useWorkspaceStore.setState({
      sims: st().sims.map((x) => ({ ...x, motor: C6, result: null, outdated: false })),
      err: null,
      simRuns: {},
    });
  });

  it('submits every row at once instead of one after another', async () => {
    const run = st().runSims(
      st().sims.map((x) => x.id),
      PREFS,
    );
    // Before: this was 1, and stayed 1 until the first flight came back.
    expect(simulateMock).toHaveBeenCalledTimes(3);

    for (const [i, c] of calls.entries()) c.resolve(result(100 + i));
    await run;
    expect(byName('A').result?.summary.maxAltitude).toBe(100);
    expect(byName('C').result?.summary.maxAltitude).toBe(102);
  });

  it('marks rows queued, then running as each reaches a worker', async () => {
    const run = st().runSims(
      st().sims.map((x) => x.id),
      PREFS,
    );
    // All three are submitted, so all three are QUEUED; none has been handed to
    // a worker yet. Queued and running stop being the same instant once there
    // is a pool, which is the distinction the table's dot needs.
    expect(['A', 'B', 'C'].map(statusOf)).toEqual(['queued', 'queued', 'queued']);

    calls[0]!.opts.onStart?.();
    calls[1]!.opts.onStart?.();
    expect(['A', 'B', 'C'].map(statusOf)).toEqual(['running', 'running', 'queued']);

    for (const [i, c] of calls.entries()) c.resolve(result(100 + i));
    await run;
    expect(['A', 'B', 'C'].map(statusOf)).toEqual(['upToDate', 'upToDate', 'upToDate']);
    expect(st().simRuns).toEqual({}); // transient state cleared, not left behind
  });

  it('installs each result by id, whatever order they land in', async () => {
    const run = st().runSims(
      st().sims.map((x) => x.id),
      PREFS,
    );
    // Out of order on purpose: with a pool the fastest flight finishes first,
    // and nothing may depend on submission order.
    calls[2]!.resolve(result(3));
    calls[0]!.resolve(result(1));
    calls[1]!.resolve(result(2));
    await run;
    expect(byName('A').result?.summary.maxAltitude).toBe(1);
    expect(byName('B').result?.summary.maxAltitude).toBe(2);
    expect(byName('C').result?.summary.maxAltitude).toBe(3);
  });

  it('one failure marks its own row and leaves the rest of the batch alone', async () => {
    const run = st().runSims(
      st().sims.map((x) => x.id),
      PREFS,
    );
    calls[1]!.reject(new Error('degenerate geometry'));
    calls[0]!.resolve(result(1));
    calls[2]!.resolve(result(3));
    await run;

    expect(statusOf('B')).toBe('failed');
    expect(byName('B').result).toBeNull();
    // The other two flew and installed, rather than being taken down with it.
    expect(statusOf('A')).toBe('upToDate');
    expect(statusOf('C')).toBe('upToDate');
    expect(st().err).toContain('degenerate geometry');
  });

  it('drops every answer when the design changes mid-batch', async () => {
    const ranOn = st().tree;
    const run = st().runSims(
      st().sims.map((x) => x.id),
      PREFS,
    );
    // An edit while the pool is busy: the answers still coming back describe a
    // rocket that is no longer on screen.
    useWorkspaceStore.setState({ tree: structuredClone(ranOn) });
    for (const [i, c] of calls.entries()) c.resolve(result(100 + i));
    await run;
    expect(st().sims.every((x) => x.result === null)).toBe(true);
    useWorkspaceStore.setState({ tree: ranOn });
  });

  it('clears the busy flag once the whole batch has settled, not the first row', async () => {
    const run = st().runSims(
      st().sims.map((x) => x.id),
      PREFS,
    );
    expect(st().simBusy).toBe(true);
    calls[0]!.resolve(result(1));
    await Promise.resolve();
    expect(st().simBusy).toBe(true); // two still in the air
    calls[1]!.resolve(result(2));
    calls[2]!.resolve(result(3));
    await run;
    expect(st().simBusy).toBe(false);
  });
});

/**
 * Cancel and "run outdated", the two batch controls the pool made worth having.
 */
describe('canceling a batch', () => {
  let calls: Call[];

  beforeEach(() => {
    calls = [];
    simulateMock.mockReset();
    simulateMock.mockImplementation((_p: SimPayload, opts: SimCallOptions = {}) => {
      return new Promise<FlightResult>((resolve, reject) => {
        const c: Call = { opts, resolve, reject };
        calls.push(c);
        // The real client rejects with SimCanceledError on abort; the store
        // has to tell that apart from a genuine failure.
        opts.signal?.addEventListener('abort', () => reject(new SimCanceledError()));
      });
    });

    st().setSimsSelected([]);
    while (st().sims.length > 1) st().deleteSim(st().sims[st().sims.length - 1]!.id);
    st().renameSim(st().sims[0]!.id, 'A');
    st().addSim();
    st().renameSim(st().sims[1]!.id, 'B');
    st().commitEdit();
    useWorkspaceStore.setState({
      sims: st().sims.map((x) => ({ ...x, motor: C6, result: null, outdated: false })),
      err: null,
      simRuns: {},
    });
  });

  it('keeps what already landed and clears the rest', async () => {
    const run = st().runSims(
      st().sims.map((x) => x.id),
      PREFS,
    );
    calls[0]!.resolve(result(42));
    await Promise.resolve();

    st().cancelRun();
    await run;

    // Canceling is "stop what is still going", not an undo.
    expect(byName('A').result?.summary.maxAltitude).toBe(42);
    expect(byName('B').result).toBeNull();
    expect(st().simRuns).toEqual({});
    expect(st().simBusy).toBe(false);
  });

  it('does not mark a canceled row as failed', async () => {
    const run = st().runSims(
      st().sims.map((x) => x.id),
      PREFS,
    );
    st().cancelRun();
    await run;
    // The user stopped it; that is not a fault, so no red dot and no banner.
    expect(statusOf('B')).toBe('notRun');
    expect(st().err).toBeNull();
  });

  it('a later run is unaffected by an earlier cancel', async () => {
    const first = st().runSims([byName('A').id], PREFS);
    st().cancelRun();
    await first;

    const second = st().runSims([byName('A').id], PREFS);
    calls[calls.length - 1]!.resolve(result(7));
    await second;
    expect(byName('A').result?.summary.maxAltitude).toBe(7);
  });
});

describe('running everything outdated', () => {
  beforeEach(() => {
    simulateMock.mockReset();
    simulateMock.mockResolvedValue(result(50));
    st().setSimsSelected([]);
    while (st().sims.length > 1) st().deleteSim(st().sims[st().sims.length - 1]!.id);
    st().renameSim(st().sims[0]!.id, 'Fresh');
    st().addSim();
    st().renameSim(st().sims[1]!.id, 'Stale');
    st().addSim();
    st().renameSim(st().sims[2]!.id, 'NeverFlown');
    st().commitEdit();
    useWorkspaceStore.setState({
      sims: st().sims.map((x) => ({
        ...x,
        motor: C6,
        result: x.name === 'NeverFlown' ? null : result(1),
        outdated: x.name === 'Stale',
      })),
      err: null,
      simRuns: {},
    });
  });

  it('flies the stale and the never-flown, and leaves the current one alone', async () => {
    await st().runOutdated(PREFS);
    expect(simulateMock).toHaveBeenCalledTimes(2);
    expect(byName('Stale').result?.summary.maxAltitude).toBe(50);
    expect(byName('NeverFlown').result?.summary.maxAltitude).toBe(50);
    expect(byName('Fresh').result?.summary.maxAltitude).toBe(1); // untouched
  });

  it('ignores the tick boxes', async () => {
    // "Bring this workspace up to date" is a different question from "fly these
    // rows", so a selection must not narrow it.
    st().setSimsSelected([byName('Fresh').id]);
    await st().runOutdated(PREFS);
    expect(simulateMock).toHaveBeenCalledTimes(2);
  });

  it('does nothing at all when every row is current', async () => {
    useWorkspaceStore.setState({
      sims: st().sims.map((x) => ({ ...x, result: result(1), outdated: false })),
    });
    await st().runOutdated(PREFS);
    expect(simulateMock).not.toHaveBeenCalled();
    expect(st().simBusy).toBe(false);
  });
});

/**
 * Editing a simulation while it flies.
 *
 * The design has always had `ranOn`: an answer flown against a tree that has
 * since changed is discarded. A row's OWN inputs had no such guard, and were
 * protected by locking the simulation editor for the duration of a run instead.
 * That lock is gone, so the guard has to be real: a result installs with
 * `outdated: false`, and without the check it would overwrite an edit made
 * mid-run and leave the row claiming to be current against conditions it no
 * longer has.
 */
describe('a simulation edited while it is in the air', () => {
  let calls: Call[];

  beforeEach(() => {
    calls = [];
    simulateMock.mockReset();
    simulateMock.mockImplementation((_p: SimPayload, opts: SimCallOptions = {}) => {
      return new Promise<FlightResult>((resolve, reject) => {
        calls.push({ opts, resolve, reject });
      });
    });

    st().setSimsSelected([]);
    while (st().sims.length > 1) st().deleteSim(st().sims[st().sims.length - 1]!.id);
    st().renameSim(st().sims[0]!.id, 'A');
    st().addSim();
    st().renameSim(st().sims[1]!.id, 'B');
    st().commitEdit();
    useWorkspaceStore.setState({
      sims: st().sims.map((x) => ({ ...x, motor: C6, result: null, outdated: false })),
      err: null,
      simRuns: {},
    });
  });

  it('drops the answer when its launch conditions changed underneath it', async () => {
    const target = byName('A').id;
    const run = st().runSims([target], PREFS);

    // Edit the row that is flying. `patchLaunch` hits the ACTIVE simulation, so
    // point the editor at it first.
    st().setActiveId(target);
    st().patchLaunch({ windAverage: 7 });
    st().commitEdit();

    calls[0]!.resolve(result(999));
    await run;

    // The numbers described the wind it no longer has, so they are not kept.
    expect(byName('A').result).toBeNull();
    expect(byName('A').outdated).toBe(true);
    expect(st().simRuns).toEqual({});
  });

  it('keeps the answer when the edit landed on a DIFFERENT simulation', async () => {
    const target = byName('A').id;
    const run = st().runSims([target], PREFS);

    st().setActiveId(byName('B').id);
    st().patchLaunch({ windAverage: 7 });
    st().commitEdit();

    calls[0]!.resolve(result(123));
    await run;
    // Nothing this flight depends on moved, so it installs as normal.
    expect(byName('A').result?.summary.maxAltitude).toBe(123);
    expect(byName('A').outdated).toBe(false);
  });

  it('drops it for a motor swap too, not just launch conditions', async () => {
    const target = byName('A').id;
    const run = st().runSims([target], PREFS);

    st().setActiveId(target);
    st().setActiveMotor({ ...C6, designation: 'D12' });

    calls[0]!.resolve(result(500));
    await run;
    expect(byName('A').result).toBeNull();
  });

  it('installs normally when nothing is touched', async () => {
    const run = st().runSims([byName('A').id], PREFS);
    calls[0]!.resolve(result(77));
    await run;
    expect(byName('A').result?.summary.maxAltitude).toBe(77);
  });
});
