import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerRequest, WorkerResponse } from './simProtocol';

/**
 * The worker's message loop, driven directly: `self` is the module's
 * `DedicatedWorkerGlobalScope`, which in this process is `globalThis`, so the
 * handler it installs is `globalThis.onmessage` and its replies go to a
 * stubbed `postMessage`. The engine is mocked; these assert the PROTOCOL the
 * worker keeps, not the physics.
 */
const engine = vi.hoisted(() => ({
  initEngine: vi.fn(),
  resetEngine: vi.fn(),
}));
vi.mock('./openRocketEngine', () => engine);
vi.mock('../services/buildRocket', () => ({
  buildConfiguredRocket: () => ({ simulate: () => ({ summary: {}, events: [], series: {} }) }),
}));

const posted: WorkerResponse[] = [];
/** The stand-in for DedicatedWorkerGlobalScope the module installs its handler on. */
const g: {
  onmessage: ((e: { data: WorkerRequest }) => Promise<void>) | null;
  postMessage: (m: WorkerResponse) => void;
} = {
  onmessage: null,
  postMessage: (m) => posted.push(m),
};

beforeEach(async () => {
  posted.length = 0;
  g.onmessage = null;
  vi.stubGlobal('self', g);
  engine.initEngine.mockReset();
  engine.resetEngine.mockReset();
  vi.resetModules();
  await import('./simWorker');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const send = (req: Omit<WorkerRequest, 'engine'> & { engine?: WorkerRequest['engine'] }) =>
  g.onmessage!({ data: { engine: 'auto', ...req } as WorkerRequest });

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
    // A module-level `const ready = initEngine()` that rejected was an
    // unhandled rejection, and the dead worker then answered every call with
    // "engine not initialized" until its idle reaper got to it.
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
});
