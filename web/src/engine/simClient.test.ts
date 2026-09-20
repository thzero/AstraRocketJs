import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimPayload } from './simProtocol';

// The client is a module singleton (it caches its worker pool), so each test
// resets modules and re-imports to get a fresh pool. We stub the global Worker
// with a controllable fake instead of spinning up the real simWorker chunk.

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessageerror: ((e: unknown) => void) | null = null;
  terminate = vi.fn();
  /** Every request this worker has been handed, in order. */
  posts: { id: number; engine?: string; method?: string }[] = [];
  // Set per-test: how this worker answers a postMessage (default: never).
  static onPost: (self: FakeWorker, msg: { id: number }) => void = () => {};
  postMessage(msg: { id: number }) {
    this.posts.push(msg);
    FakeWorker.onPost(this, msg);
  }
  /** Answer a request this worker is holding, as the real worker would. */
  reply(id: number, result: unknown = { ok: true }) {
    this.onmessage?.({ data: { id, ok: true, result } } as MessageEvent);
  }
  /** Refuse a request: `fatal` means "this worker's engine never loaded". */
  fail(id: number, error: string, fatal?: true) {
    this.onmessage?.({ data: { id, ok: false, error, fatal } } as MessageEvent);
  }
}

const created: FakeWorker[] = [];

/** Pretend this machine has `n` cores. The pool takes n-1, capped at 4. */
function withCores(n: number) {
  vi.stubGlobal('navigator', { hardwareConcurrency: n });
}

beforeEach(() => {
  created.length = 0;
  FakeWorker.onPost = () => {}; // a hung worker: never replies
  vi.stubGlobal(
    'Worker',
    // A regular function (not an arrow): vitest 5's spies keep the underlying
    // implementation's (non-)constructability, and `new Worker(...)` — how the
    // client creates it — needs a constructable stub. Returning an object from a
    // `new` call yields that object, so each construction hands back a FakeWorker.
    vi.fn(function () {
      const w = new FakeWorker();
      created.push(w);
      return w;
    }),
  );
  withCores(2); // one worker unless a test says otherwise
  vi.useFakeTimers();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const payload = {} as unknown as SimPayload;

/**
 * Fire a sim nobody awaits.
 *
 * Every call arms a timeout, so an unsettled one left behind by a test rejects
 * the moment a LATER test advances the clock past it - surfacing as an
 * unhandled rejection in whichever test happened to be running. Swallowing here
 * keeps each test's failures its own.
 */
function fire(run: () => Promise<unknown>): void {
  void run().catch(() => {});
}

describe('simClient timeout', () => {
  it('rejects with SimTimeoutError and terminates a hung worker', async () => {
    const { simulateInWorker, SimTimeoutError } = await import('./simClient');
    const p = simulateInWorker(payload, { timeoutMs: 1000 });
    const rejects = expect(p).rejects.toBeInstanceOf(SimTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await rejects;
    expect(created).toHaveLength(1);
    expect(created[0]!.terminate).toHaveBeenCalledOnce(); // hung worker was killed
  });

  it('resolves normally and does not fire the timeout for a prompt reply', async () => {
    FakeWorker.onPost = (self, msg) => self.reply(msg.id, { apogee: 42 });
    const { simulateInWorker } = await import('./simClient');
    const result = await simulateInWorker(payload, { timeoutMs: 1000 });
    expect(result).toEqual({ apogee: 42 });
    // Advancing past the timeout must not retroactively kill the (now idle) worker.
    await vi.advanceTimersByTimeAsync(1000);
    expect(created[0]!.terminate).not.toHaveBeenCalled();
  });
});

/**
 * The pool is the whole point of running a batch: `simulate()` inside a worker
 * is a synchronous engine call, so four requests to ONE worker are four flights
 * end to end. These assert the transport actually spreads them.
 */
describe('simClient pool', () => {
  it('runs several sims at once, one per worker', async () => {
    withCores(5); // 5 - 1 = 4 workers
    const { simulateInWorker } = await import('./simClient');
    for (let i = 0; i < 4; i++) fire(() => simulateInWorker(payload));
    expect(created).toHaveLength(4);
    // One request each, rather than four stacked on the first worker.
    expect(created.map((w) => w.posts.length)).toEqual([1, 1, 1, 1]);
  });

  it('leaves a core for the main thread and caps the pool', async () => {
    withCores(32);
    const { simulateInWorker, simConcurrency } = await import('./simClient');
    expect(simConcurrency()).toBe(4); // capped: each worker is a whole engine
    for (let i = 0; i < 8; i++) fire(() => simulateInWorker(payload));
    expect(created).toHaveLength(4);
  });

  it('queues past the pool limit and dispatches as workers free up', async () => {
    withCores(3); // 2 workers
    const { simulateInWorker } = await import('./simClient');
    const started: number[] = [];
    for (let i = 0; i < 3; i++) fire(() => simulateInWorker(payload, { onStart: () => started.push(i) }));
    // Two in the air, the third waiting - not a third worker.
    expect(created).toHaveLength(2);
    expect(started).toEqual([0, 1]);

    created[0]!.reply(created[0]!.posts[0]!.id);
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    expect(created).toHaveLength(2); // reused, not spawned again
    expect(created[0]!.posts).toHaveLength(2);
  });

  it('spawns lazily rather than filling the pool up front', async () => {
    withCores(5);
    const { simulateInWorker } = await import('./simClient');
    fire(() => simulateInWorker(payload));
    expect(created).toHaveLength(1);
  });

  /**
   * The reason `killWorker` had to stop being global. With one worker it could
   * reject everything in flight, because everything in flight was on it. One
   * degenerate rocket must not take down three healthy flights beside it.
   */
  it('a timeout kills only the worker that hung', async () => {
    withCores(3); // 2 workers
    const { simulateInWorker, SimTimeoutError } = await import('./simClient');
    const hung = simulateInWorker(payload, { timeoutMs: 1000 });
    const healthy = simulateInWorker(payload, { timeoutMs: 1000 });
    expect(created).toHaveLength(2);

    // Attached BEFORE the clock moves: the rejection lands during
    // advanceTimers, and a promise with no handler yet at that instant is an
    // unhandled rejection even though the very next line would have awaited it.
    const rejects = expect(hung).rejects.toBeInstanceOf(SimTimeoutError);

    // The second worker answers; the first never will.
    created[1]!.reply(created[1]!.posts[0]!.id, { apogee: 7 });
    await expect(healthy).resolves.toEqual({ apogee: 7 });

    await vi.advanceTimersByTimeAsync(1000);
    await rejects;
    expect(created[0]!.terminate).toHaveBeenCalledOnce();
    expect(created[1]!.terminate).not.toHaveBeenCalled();
  });

  it('a crashed worker fails only its own call, and the pool recovers', async () => {
    withCores(3);
    const { simulateInWorker } = await import('./simClient');
    const doomed = simulateInWorker(payload);
    const other = simulateInWorker(payload);
    created[0]!.onerror?.({ message: 'boom' });
    await expect(doomed).rejects.toThrow('boom');

    created[1]!.reply(created[1]!.posts[0]!.id, { apogee: 1 });
    await expect(other).resolves.toEqual({ apogee: 1 });

    // A later sim spawns a replacement rather than reusing the dead slot.
    FakeWorker.onPost = (self, msg) => self.reply(msg.id, { apogee: 2 });
    await expect(simulateInWorker(payload)).resolves.toEqual({ apogee: 2 });
  });

  it('reaps idle workers so an editing session does not sit on four engines', async () => {
    withCores(5);
    const { simulateInWorker } = await import('./simClient');
    // Both in the air BEFORE either answers, so the second gets its own worker.
    // A worker that replies inside postMessage frees its slot instantly and the
    // next sim reuses it, which is correct and would test nothing here.
    const both = Promise.all([simulateInWorker(payload), simulateInWorker(payload)]);
    expect(created).toHaveLength(2);
    for (const w of created) w.reply(w.posts[0]!.id, { apogee: 3 });
    await both;
    expect(created.every((w) => !w.terminate.mock.calls.length)).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(created.every((w) => w.terminate.mock.calls.length === 1)).toBe(true);

    // And the pool refills on the next run.
    FakeWorker.onPost = (self, msg) => self.reply(msg.id, { apogee: 3 });
    await expect(simulateInWorker(payload)).resolves.toEqual({ apogee: 3 });
    expect(created).toHaveLength(3);
  });

  it('does not reap a worker that picked up new work while idling', async () => {
    withCores(2); // one worker, so the second sim must reuse it
    FakeWorker.onPost = (self, msg) => self.reply(msg.id, { apogee: 4 });
    const { simulateInWorker } = await import('./simClient');
    await simulateInWorker(payload);
    await vi.advanceTimersByTimeAsync(30_000); // half way to the reap
    await simulateInWorker(payload);
    await vi.advanceTimersByTimeAsync(40_000); // past the ORIGINAL deadline
    // The second run rearmed the timer, so the worker is still alive at 70s.
    expect(created).toHaveLength(1);
    expect(created[0]!.terminate).not.toHaveBeenCalled();
  });
});

/**
 * Cancel. `simulate()` inside a worker is synchronous, so a run already in a
 * worker can only be stopped by terminating it; one still waiting for its turn
 * costs nothing to drop.
 */
describe('simClient cancel', () => {
  it('drops a queued run without touching any worker', async () => {
    withCores(2); // one worker, so the second call has to wait
    const { simulateInWorker, SimCanceledError } = await import('./simClient');
    const ac = new AbortController();
    const running = simulateInWorker(payload);
    const waiting = simulateInWorker(payload, { signal: ac.signal });
    expect(created).toHaveLength(1);

    const rejects = expect(waiting).rejects.toBeInstanceOf(SimCanceledError);
    ac.abort();
    await rejects;
    // The worker serving the FIRST run is untouched: it was never the one
    // holding the canceled task.
    expect(created[0]!.terminate).not.toHaveBeenCalled();

    created[0]!.reply(created[0]!.posts[0]!.id, { apogee: 5 });
    await expect(running).resolves.toEqual({ apogee: 5 });
  });

  it('terminates the worker of a run already in flight', async () => {
    withCores(3);
    const { simulateInWorker, SimCanceledError } = await import('./simClient');
    const ac = new AbortController();
    const doomed = simulateInWorker(payload, { signal: ac.signal });
    const other = simulateInWorker(payload);

    const rejects = expect(doomed).rejects.toBeInstanceOf(SimCanceledError);
    ac.abort();
    await rejects;
    expect(created[0]!.terminate).toHaveBeenCalledOnce();
    // Only its own worker: the flight beside it is still going.
    expect(created[1]!.terminate).not.toHaveBeenCalled();
    created[1]!.reply(created[1]!.posts[0]!.id, { apogee: 6 });
    await expect(other).resolves.toEqual({ apogee: 6 });
  });

  it('hands a freed-up worker the next queued run when one is canceled', async () => {
    withCores(2); // one worker
    const { simulateInWorker } = await import('./simClient');
    const ac = new AbortController();
    const started: string[] = [];
    fire(() => simulateInWorker(payload, { signal: ac.signal, onStart: () => started.push('first') }));
    fire(() => simulateInWorker(payload, { onStart: () => started.push('second') }));
    expect(started).toEqual(['first']);

    // Killing the worker mid-run must not strand the queue behind it.
    ac.abort();
    await Promise.resolve();
    expect(started).toEqual(['first', 'second']);
    expect(created).toHaveLength(2); // a replacement for the terminated one
  });

  it('does nothing when the run has already finished', async () => {
    FakeWorker.onPost = (self, msg) => self.reply(msg.id, { apogee: 9 });
    const { simulateInWorker } = await import('./simClient');
    const ac = new AbortController();
    await expect(simulateInWorker(payload, { signal: ac.signal })).resolves.toEqual({ apogee: 9 });
    // A late abort must not reach back and kill a worker that has moved on to
    // somebody else's flight.
    ac.abort();
    expect(created[0]!.terminate).not.toHaveBeenCalled();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const { simulateInWorker, SimCanceledError } = await import('./simClient');
    const ac = new AbortController();
    ac.abort();
    await expect(simulateInWorker(payload, { signal: ac.signal })).rejects.toBeInstanceOf(SimCanceledError);
    expect(created).toHaveLength(0); // never even spawned a worker
  });
});

describe('simClient worker retirement', () => {
  it('kills a worker that reports a FATAL engine failure and spawns a fresh one for the next call', async () => {
    FakeWorker.onPost = (self, msg) => self.fail(msg.id, 'engine failed to load', true);
    const { simulateInWorker } = await import('./simClient');
    await expect(simulateInWorker(payload)).rejects.toThrow('engine failed to load');
    // Retired, not left in the pool answering every call with the same error.
    expect(created[0]!.terminate).toHaveBeenCalledOnce();

    // The next call gets a NEW worker (which, here, is healthy).
    FakeWorker.onPost = (self, msg) => self.reply(msg.id, { apogee: 1 });
    await expect(simulateInWorker(payload)).resolves.toEqual({ apogee: 1 });
    expect(created).toHaveLength(2);
  });

  it('a plain (non-fatal) error rejects the call but keeps the worker', async () => {
    FakeWorker.onPost = (self, msg) => self.fail(msg.id, 'bad geometry');
    const { simulateInWorker } = await import('./simClient');
    await expect(simulateInWorker(payload)).rejects.toThrow('bad geometry');
    expect(created[0]!.terminate).not.toHaveBeenCalled();
  });

  it('kills the slot on a reply that cannot be deserialized (onmessageerror)', async () => {
    const { simulateInWorker } = await import('./simClient');
    const p = simulateInWorker(payload); // never answered normally
    const rejects = expect(p).rejects.toThrow(/deserialized/);
    created[0]!.onmessageerror?.({});
    await rejects;
    expect(created[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('carries the backend preference on every request, since a worker cannot read it', async () => {
    const { simulateInWorker, warmSimWorker } = await import('./simClient');
    warmSimWorker();
    fire(() => simulateInWorker(payload));
    // In this process there is no `?engine=` and no localStorage override: auto.
    expect(created[0]!.posts.map((p) => [p.method, p.engine])).toEqual([['ping', 'auto']]);
  });
});
