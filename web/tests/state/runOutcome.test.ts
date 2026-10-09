import { describe, it, expect, beforeEach, vi } from 'vitest';

// The sim normally runs in a Web Worker pool; stub the client so a test decides
// when, and how, each flight settles.
const simulateMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/engine/simClient', async (orig) => ({
  ...(await orig<typeof import('../../src/engine/simClient')>()),
  simulateInWorker: simulateMock,
}));

import { useWorkspaceStore, selectActive } from '../../src/state/store';
import { SimCanceledError, SimTimeoutError, type SimCallOptions } from '../../src/engine/simClient';
import type { SimPayload } from '../../src/engine/simProtocol';
import type { FlightResult } from '../../src/engine/openRocketEngine';
import { seatMotor, CURVELESS } from '../testing/seatMotor';

const st = () => useWorkspaceStore.getState();
const RESULT = { summary: { maxAltitude: 100 }, events: [], series: {} } as unknown as FlightResult;

beforeEach(() => {
  simulateMock.mockReset();
  st().resetWorkspace();
});

/**
 * A run reports how each row came out. The PDF export waits on it to decide
 * whether the report has fresh numbers, and a run that resolved the same way
 * for a landing and for a timeout would let it write the previous run's.
 */
describe('run outcomes', () => {
  it('is landed when the flight comes back', async () => {
    simulateMock.mockResolvedValue(RESULT);
    expect(await st().runSim()).toBe('landed');
  });

  it('is failed when the flight throws or times out', async () => {
    simulateMock.mockRejectedValueOnce(new Error('kernel exploded'));
    expect(await st().runSim()).toBe('failed');
    simulateMock.mockRejectedValueOnce(new SimTimeoutError());
    expect(await st().runSim()).toBe('failed');
  });

  it('is canceled when the user stops it', async () => {
    simulateMock.mockRejectedValueOnce(new SimCanceledError());
    expect(await st().runSim()).toBe('canceled');
  });

  it('is skipped when the row cannot fly', async () => {
    seatMotor(selectActive(st()).name, CURVELESS);
    expect(await st().runSim()).toBe('skipped');
    expect(simulateMock).not.toHaveBeenCalled();
  });

  it('is failed for every row when the design is blocked', async () => {
    st().setSelectedId('mount');
    st().removeSelected();
    expect(await st().runSim()).toBe('failed');
  });

  it('is dropped when the design moves on mid-flight', async () => {
    let release!: (r: FlightResult) => void;
    simulateMock.mockImplementationOnce(() => new Promise<FlightResult>((res) => (release = res)));
    const running = st().runSim();
    st().setSelectedId('nose');
    st().patchSelected({ length: 0.3 });
    release(RESULT);
    expect(await running).toBe('dropped');
  });

  it('flies the preferences the store mirrors', async () => {
    simulateMock.mockResolvedValue(RESULT);
    st().setSimPrefs({ ...st().simPrefs, timeStep: 0.0123 });
    await st().runSim();
    expect((simulateMock.mock.calls[0]![0] as SimPayload).options.timeStep).toBe(0.0123);
  });
});

/**
 * One batch at a time. A second one taking over the cancel handle and the busy
 * flag leaves the first unreachable by Cancel and the app reading idle while it
 * is still flying.
 */
describe('a run started while another is in flight', () => {
  let calls: { opts: SimCallOptions; resolve: (r: FlightResult) => void; reject: (e: Error) => void }[];

  beforeEach(() => {
    calls = [];
    simulateMock.mockImplementation(
      (_p: SimPayload, opts: SimCallOptions = {}) =>
        new Promise<FlightResult>((resolve, reject) => {
          calls.push({ opts, resolve, reject });
          opts.signal?.addEventListener('abort', () => reject(new SimCanceledError()));
        }),
    );
  });

  it('is refused, says so, and leaves the first batch in charge', async () => {
    const first = st().runSim();
    expect(st().simBusy).toBe(true);

    expect(await st().runSim()).toBe('busy');
    expect(calls).toHaveLength(1); // nothing new dispatched
    expect(st().err).toBeTruthy();
    expect(st().simBusy).toBe(true); // the first is still flying

    // Cancel still reaches the first batch.
    st().cancelRun();
    expect(await first).toBe('canceled');
    expect(st().simBusy).toBe(false);
  });

  it('is allowed once the first has finished', async () => {
    const first = st().runSim();
    calls[0]!.resolve(RESULT);
    expect(await first).toBe('landed');

    const second = st().runSim();
    calls[1]!.resolve(RESULT);
    expect(await second).toBe('landed');
  });
});
