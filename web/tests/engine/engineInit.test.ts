import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A stub stands in for the JS build: the tests are about which backend the load
// settles on, not about the kernel.
const jsEngine = vi.hoisted(() => ({ setLengthUnit: () => {}, buildRocket: () => 0 }));
vi.mock('../../src/engine/vendor/openrocket-engine.mjs', () => jsEngine);

type EngineModule = typeof import('../../src/engine/openRocketEngine');
type Wasm = { load: (bytes: ArrayBuffer, options?: unknown) => Promise<{ exports: unknown }> };

const g = globalThis as unknown as { TeaVM?: { wasmGC?: Wasm } };

/** A fresh copy of the module, so the memoized load and the backend flags start over. */
async function freshEngine(): Promise<EngineModule> {
  vi.resetModules();
  return await import('../../src/engine/openRocketEngine');
}

/** A fetch that never answers until its signal aborts, as a proxy that holds the request does. */
function stalledFetch(): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason as Error), { once: true });
    })) as typeof fetch;
}

describe('engine load', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The runtime is already installed, so the load goes straight to the .wasm fetch.
    g.TeaVM = {
      wasmGC: { load: () => Promise.resolve({ exports: { buildRocket: () => 0, setLengthUnit: () => {} } }) },
    };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete g.TeaVM;
  });

  it('falls back to the JS build when the WASM fetch stalls', async () => {
    vi.stubGlobal('fetch', stalledFetch());
    const engine = await freshEngine();
    let settled: string | null = null;
    void engine.initEngine(undefined, 'auto').then((b) => (settled = b));
    await vi.advanceTimersByTimeAsync(engine.WASM_STALL_MS + 1);
    expect(settled).toBe('js');
  });

  it('does not cut off a slow download that is still moving', async () => {
    const chunks = 6;
    vi.stubGlobal('fetch', (() => {
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull: (ctl) =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              if (sent++ < chunks) ctl.enqueue(new Uint8Array(8));
              else ctl.close();
              resolve();
            }, 10_000),
          ),
      });
      return Promise.resolve(new Response(body));
    }) as typeof fetch);
    const engine = await freshEngine();
    let settled: string | null = null;
    void engine.initEngine(undefined, 'auto').then((b) => (settled = b));
    // Longer than the stall ceiling in total, never that long between bytes.
    await vi.advanceTimersByTimeAsync((chunks + 1) * 10_000 + 1);
    expect(settled).toBe('wasm');
  });

  it('says a retry cannot recover the load once the browser cannot compile the WASM build', async () => {
    vi.stubGlobal('fetch', (() => Promise.resolve(new Response(new Uint8Array(8)))) as typeof fetch);
    g.TeaVM!.wasmGC!.load = () => Promise.reject(new WebAssembly.CompileError('no GC types'));
    const engine = await freshEngine();
    expect(engine.engineRetryCanRecover()).toBe(true);
    await expect(engine.initEngine(undefined, 'auto')).resolves.toBe('js');
    expect(engine.engineRetryCanRecover()).toBe(false);
  });

  it('keeps the retry when the WASM download merely failed', async () => {
    vi.stubGlobal('fetch', (() => Promise.reject(new TypeError('network down'))) as typeof fetch);
    const engine = await freshEngine();
    await expect(engine.initEngine(undefined, 'auto')).resolves.toBe('js');
    expect(engine.engineRetryCanRecover()).toBe(true);
  });

  it('says a retry cannot recover the load when the JS build is forced', async () => {
    const engine = await freshEngine();
    await expect(engine.initEngine(undefined, 'js')).resolves.toBe('js');
    expect(engine.engineRetryCanRecover()).toBe(false);
  });
});
