import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimPayload } from './simProtocol';

// The client is a module singleton (it caches one worker), so each test resets
// modules and re-imports to get a fresh worker. We stub the global Worker with a
// controllable fake instead of spinning up the real simWorker chunk.

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminate = vi.fn();
  // Set per-test: how this worker answers a postMessage (default: never).
  static onPost: (self: FakeWorker, msg: { id: number }) => void = () => {};
  postMessage(msg: { id: number }) { FakeWorker.onPost(this, msg); }
}

const created: FakeWorker[] = [];

beforeEach(() => {
  created.length = 0;
  FakeWorker.onPost = () => {}; // a hung worker: never replies
  vi.stubGlobal('Worker', vi.fn(() => { const w = new FakeWorker(); created.push(w); return w; }));
  vi.useFakeTimers();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('simClient timeout', () => {
  it('rejects with SimTimeoutError and terminates a hung worker', async () => {
    const { simulateInWorker, SimTimeoutError } = await import('./simClient');
    const p = simulateInWorker({} as unknown as SimPayload, 1000);
    const rejects = expect(p).rejects.toBeInstanceOf(SimTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await rejects;
    expect(created).toHaveLength(1);
    expect(created[0].terminate).toHaveBeenCalledOnce(); // hung worker was killed
  });

  it('resolves normally and does not fire the timeout for a prompt reply', async () => {
    FakeWorker.onPost = (self, msg) => {
      self.onmessage?.({ data: { id: msg.id, ok: true, result: { apogee: 42 } } } as MessageEvent);
    };
    const { simulateInWorker } = await import('./simClient');
    const result = await simulateInWorker({} as unknown as SimPayload, 1000);
    expect(result).toEqual({ apogee: 42 });
    // Advancing past the timeout must not retroactively kill the (now idle) worker.
    await vi.advanceTimersByTimeAsync(2000);
    expect(created[0].terminate).not.toHaveBeenCalled();
  });
});
