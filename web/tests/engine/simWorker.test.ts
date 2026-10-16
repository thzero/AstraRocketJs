import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerReady, WorkerRequest, WorkerResponse } from '../../src/engine/simProtocol';
import { englishText } from '../../src/i18n/keyedError';

/**
 * The worker's message loop, driven directly: `self` is the module's
 * `DedicatedWorkerGlobalScope`, which in this process is `globalThis`, so the
 * handler it installs is `globalThis.onmessage` and its replies go to a
 * stubbed `postMessage`. The engine is mocked; these assert the protocol the
 * worker keeps, not the physics.
 */
const engine = vi.hoisted(() => ({
  initEngine: vi.fn(),
  resetEngine: vi.fn(),
  setKernelLengthUnit: vi.fn(),
}));
vi.mock('../../src/engine/openRocketEngine', () => engine);
vi.mock('../../src/services/design/buildRocket', () => ({
  buildConfiguredRocket: () => ({ simulate: () => ({ summary: {}, events: [], series: {} }) }),
}));

const posted: WorkerResponse[] = [];
/** The unprompted engine-ready notices, kept apart from the replies. */
const readies: WorkerReady[] = [];
/** The stand-in for DedicatedWorkerGlobalScope the module installs its handler on. */
const g: {
  onmessage: ((e: { data: WorkerRequest }) => Promise<void>) | null;
  postMessage: (m: WorkerResponse | WorkerReady) => void;
} = {
  onmessage: null,
  postMessage: (m) => {
    if ('ready' in m) readies.push(m);
    else posted.push(m);
  },
};

beforeEach(async () => {
  posted.length = 0;
  readies.length = 0;
  g.onmessage = null;
  vi.stubGlobal('self', g);
  engine.initEngine.mockReset();
  engine.resetEngine.mockReset();
  engine.setKernelLengthUnit.mockReset();
  vi.resetModules();
  await import('../../src/engine/simWorker');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const send = (
  req: Omit<WorkerRequest, 'engine' | 'lengthUnit'> & { engine?: WorkerRequest['engine']; lengthUnit?: string },
) => g.onmessage!({ data: { engine: 'auto', lengthUnit: 'cm', ...req } as WorkerRequest });

describe('simWorker', () => {
  it("answers ping once the engine is up, passing the main thread's backend preference through", async () => {
    engine.initEngine.mockResolvedValue('js');
    await send({ id: 1, method: 'ping', args: null, engine: 'js' });
    expect(posted).toEqual([{ id: 1, ok: true, result: 'ok' }]);
    // The preference is what the first request carried; the worker cannot
    // read the page's `?engine=` or localStorage itself.
    expect(engine.initEngine).toHaveBeenCalledWith(undefined, 'js');
    expect(engine.initEngine).toHaveBeenCalledTimes(1);
  });

  it('starts the engine once, on the first request, whatever it is', async () => {
    engine.initEngine.mockResolvedValue('js');
    await send({ id: 1, method: 'simulate', args: {} as never });
    await send({ id: 2, method: 'ping', args: null });
    expect(engine.initEngine).toHaveBeenCalledTimes(1);
    expect(posted.map((m) => m.id)).toEqual([1, 2]);
    expect(posted.every((m) => m.ok)).toBe(true);
  });

  it('reports a failed engine load as FATAL on every request, with no unhandled rejection', async () => {
    // A rejected engine load must not escape as an unhandled rejection, and
    // each request must say the failure is fatal so the client retires the
    // worker instead of sending it more calls it cannot answer.
    engine.initEngine.mockRejectedValue(new Error('WASM and JS both failed'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await send({ id: 7, method: 'ping', args: null });
      await send({ id: 8, method: 'simulate', args: {} as never });
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      process.off('unhandledRejection', unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
    expect(posted).toHaveLength(2);
    for (const m of posted) {
      expect(m.ok).toBe(false);
      if (!m.ok) {
        expect(m.fatal).toBe(true);
        expect(m.error).toContain('WASM and JS both failed');
      }
    }
  });

  it('reports a thrown simulate as a plain (non-fatal) error', async () => {
    engine.initEngine.mockResolvedValue('js');
    engine.resetEngine.mockImplementation(() => {
      throw new Error('bad geometry');
    });
    await send({ id: 3, method: 'simulate', args: {} as never });
    expect(posted).toEqual([{ id: 3, ok: false, error: 'bad geometry' }]);
  });

  it('sends a keyed error across with its key and values, and its English text for logs', async () => {
    // The class the worker module sees: modules are reset before each test.
    const { KeyedError } = await import('../../src/i18n/keyedError');
    engine.initEngine.mockResolvedValue('js');
    engine.resetEngine.mockImplementation(() => {
      throw new KeyedError('errors.motorCurve.noMass', { motor: 'F67' });
    });
    await send({ id: 4, method: 'simulate', args: {} as never });
    expect(posted).toEqual([
      {
        id: 4,
        ok: false,
        error: englishText('errors.motorCurve.noMass', { motor: 'F67' }),
        keyed: { key: 'errors.motorCurve.noMass', values: { motor: 'F67' } },
      },
    ]);
  });

  it('keys its own engine-load failure, with the cause nested inside', async () => {
    engine.initEngine.mockRejectedValue(new Error('no engine'));
    await send({ id: 1, method: 'ping', args: null });
    const m = posted[0]!;
    expect(m.ok).toBe(false);
    if (m.ok) return;
    expect(m.keyed).toEqual({ key: 'errors.sim.engineLoad', values: { reason: 'no engine' } });
  });

  it('keys an unknown method', async () => {
    engine.initEngine.mockResolvedValue('js');
    await send({ id: 5, method: 'fly' as never, args: null });
    const m = posted[0]!;
    if (m.ok) throw new Error('expected a refusal');
    expect(m.keyed).toEqual({ key: 'errors.sim.unknownMethod', values: { method: 'fly' } });
    expect(m.fatal).toBeUndefined();
  });

  it('says once that its engine is ready, so the client can start the call timeout from there', async () => {
    engine.initEngine.mockResolvedValue('js');
    await send({ id: 1, method: 'ping', args: null });
    await send({ id: 2, method: 'ping', args: null });
    expect(readies).toEqual([{ ready: true }]);
  });

  it('does not say ready when the engine failed to load', async () => {
    engine.initEngine.mockRejectedValue(new Error('no engine'));
    await send({ id: 1, method: 'ping', args: null });
    expect(readies).toEqual([]);
  });

  it("flies in the unit the flight carries, not the main thread's", async () => {
    engine.initEngine.mockResolvedValue('js');
    await send({ id: 1, method: 'simulate', args: { lengthUnit: 'in' } as never, lengthUnit: 'cm' });
    expect(engine.setKernelLengthUnit).toHaveBeenCalledWith('in');
    await send({ id: 2, method: 'simulate', args: {} as never, lengthUnit: 'cm' });
    expect(engine.setKernelLengthUnit).toHaveBeenLastCalledWith('cm');
  });
});
