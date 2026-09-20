/**
 * Main-thread client for the sim worker (engine/simWorker.ts). Owns a POOL of
 * workers, correlates requests/responses by id, and exposes a small typed
 * surface. The transport is a generic RPC so future phases can add methods
 * without changing this plumbing (see docs/engine-worker-proposal.md).
 *
 * Why a pool. `simulate()` inside a worker is a SYNCHRONOUS engine call, so it
 * blocks that worker's message loop for the whole flight: posting four requests
 * to one worker runs them one after another, and a batch of twelve costs twelve
 * times one. Each worker holds its own engine instance and calls `resetEngine()`
 * per request (simWorker.ts), so nothing is shared between them and running four
 * flights at once is a transport change with no engine work.
 *
 * One request per worker at a time. That is what makes a hung sim survivable: a
 * timeout can terminate exactly the worker that hung, rejecting one call rather
 * than every call in flight (see {@link killWorker}).
 */
import { backendPref } from './openRocketEngine';
import type { SimPayload, WorkerCall, WorkerMethod, WorkerRequest, WorkerResponse, WorkerResults } from './simProtocol';

/** Hard ceiling for a single worker call. A flight sim is normally well under a
 *  second; if the engine hangs (degenerate geometry, an integrator that never
 *  converges) the worker's message loop is blocked, so no amount of waiting
 *  recovers it — the call must time out and the worker be killed. Generous
 *  enough that a legitimately heavy sim never trips it.
 *
 *  It starts when the call reaches a worker, NOT when it is queued: behind a
 *  full pool a request can wait several flights for its turn, and timing that
 *  wait out would punish a healthy batch for being busy. */
const SIM_TIMEOUT_MS = 30_000;

/**
 * How long an idle worker is kept before it is terminated.
 *
 * A worker is a whole TeaVM engine instance. Keeping four alive through a long
 * editing session costs that memory for nothing, and the pool refills lazily, so
 * the only price of reaping is one engine instantiation on the next batch (the
 * WASM module itself is browser-cached after the first load).
 */
const IDLE_REAP_MS = 60_000;

/**
 * Upper bound on pool size. Each worker is a full engine instance, so this
 * trades memory for wall clock; past about four the batch is usually bounded by
 * the machine's cores anyway.
 */
const MAX_POOL = 4;

/** Rejection thrown when a worker call exceeds its timeout and the worker is
 *  terminated. Distinct type so callers can show a "timed out" message rather
 *  than a raw engine error. */
export class SimTimeoutError extends Error {
  constructor() {
    super('sim timed out');
    this.name = 'SimTimeoutError';
  }
}

/**
 * Rejection thrown when a caller cancels a run.
 *
 * Distinct from {@link SimTimeoutError} because it is not a fault: the store
 * puts a canceled row back the way it was rather than marking it failed, and
 * nothing is shown in the error banner.
 */
export class SimCanceledError extends Error {
  constructor() {
    super('sim canceled');
    this.name = 'SimCanceledError';
  }
}

/** One in-flight call: the promise handles plus the timer that kills its worker. */
interface Pending {
  id: number;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** A pooled worker and the single call it is currently serving, if any. */
interface Slot {
  worker: Worker;
  busy: Pending | null;
  /** Fires IDLE_REAP_MS after this slot last went idle; cleared when it is used. */
  reaper: ReturnType<typeof setTimeout> | undefined;
}

/** A request waiting for a free worker. */
interface Queued {
  /** The method and its typed arguments, as one discriminated pair. */
  call: WorkerCall;
  timeoutMs: number | undefined;
  /** Called the moment this task is handed to a worker — see {@link SimCallOptions.onStart}. */
  onStart: (() => void) | undefined;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  /** The worker serving it, once dispatched. Canceling a dispatched task has
   *  to terminate that worker; canceling a waiting one just drops it. */
  slot: Slot | null;
  /** Detaches this task's abort listener, whatever settles it. */
  detach: (() => void) | undefined;
}

/** Every task not yet settled, queued or dispatched, so cancel can find one. */
const live = new Set<Queued>();

const pool: Slot[] = [];
const queue: Queued[] = [];
let seq = 0;

/**
 * How many workers this machine gets.
 *
 * `hardwareConcurrency - 1` leaves a core for the main thread, which is the
 * whole point of moving the work off it: saturating every core makes the UI
 * stutter again, just from a different direction. Read per call rather than
 * cached so a test can stub it.
 */
function poolLimit(): number {
  const cores = typeof navigator === 'undefined' ? 4 : (navigator.hardwareConcurrency ?? 4);
  return Math.max(1, Math.min(cores - 1, MAX_POOL));
}

function spawn(): Slot {
  // Vite compiles this to a hashed worker chunk via the new URL(...) form.
  const worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
  const slot: Slot = { worker, busy: null, reaper: undefined };
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    const p = slot.busy;
    // Not ours, or a straggler from a call that already timed out. Either way
    // there is nothing to settle; dropping it must not free the slot, which may
    // already be serving the next task.
    if (!p || p.id !== msg.id) return;
    // The worker's engine never loaded: it cannot serve this call or any
    // later one. Retire it (which rejects this call) rather than leave it in
    // the pool; the queue drains onto a fresh spawn.
    if (!msg.ok && msg.fatal) {
      killWorker(slot, new Error(msg.error));
      return;
    }
    clearTimeout(p.timer);
    slot.busy = null;
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
    // Settle first, then hand this worker its next task: a `.then` on the call
    // above must not observe an idle pool while work is still queued.
    release(slot);
  };
  worker.onerror = (e) => {
    killWorker(slot, new Error(e.message || 'sim worker crashed'));
  };
  // A reply that could not be deserialized on this side (a structured-clone
  // failure) is a reply that will never settle its call: without this the slot
  // stayed `busy` until the sim timeout fired, and a call with no timeout
  // hung forever.
  worker.onmessageerror = () => {
    killWorker(slot, new Error('sim worker reply could not be deserialized'));
  };
  pool.push(slot);
  return slot;
}

/**
 * Terminate ONE worker and fail only the call it was serving.
 *
 * With a single worker this could reject everything in flight, because
 * everything in flight was on that worker. In a pool it must not: one
 * degenerate rocket hanging one worker has nothing to do with the three healthy
 * flights beside it. The slot is dropped rather than reused — a terminated
 * worker is gone — and the queue drains onto whatever is left, spawning fresh.
 */
function killWorker(slot: Slot, err: Error): void {
  const p = slot.busy;
  slot.busy = null;
  clearTimeout(slot.reaper);
  const i = pool.indexOf(slot);
  if (i >= 0) pool.splice(i, 1);
  slot.worker.terminate();
  if (p) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  pump();
}

/** Mark a slot idle, give it the next queued task, or start its reap countdown. */
function release(slot: Slot): void {
  if (pump()) return;
  clearTimeout(slot.reaper);
  slot.reaper = setTimeout(() => {
    // Only if still idle: a task may have arrived since the timer was armed.
    if (slot.busy) return;
    const i = pool.indexOf(slot);
    if (i >= 0) pool.splice(i, 1);
    slot.worker.terminate();
  }, IDLE_REAP_MS);
  // Node returns a Timeout object with unref(); a browser returns a number and
  // has nothing to unref. Without this a reaper keeps a node process (the test
  // runner) alive for a minute after the last sim.
  (slot.reaper as unknown as { unref?: () => void }).unref?.();
}

/** Hand `task` to `slot` and start its timeout. */
function dispatch(slot: Slot, task: Queued): void {
  clearTimeout(slot.reaper);
  slot.reaper = undefined;
  const id = ++seq;
  const pending: Pending = {
    id,
    resolve: task.resolve,
    reject: task.reject,
    // On timeout the worker is hung mid-call and cannot be interrupted, so kill
    // it — that rejects this call via killWorker.
    timer:
      task.timeoutMs && task.timeoutMs > 0
        ? setTimeout(() => killWorker(slot, new SimTimeoutError()), task.timeoutMs)
        : undefined,
  };
  slot.busy = pending;
  task.slot = slot;
  task.onStart?.();
  // The backend preference rides on every request (a worker cannot read the
  // page's `?engine=` or localStorage); the worker's first request starts its
  // engine with it.
  slot.worker.postMessage({ id, engine: backendPref(), ...task.call } satisfies WorkerRequest);
}

/**
 * Move as much of the queue onto workers as the pool allows, spawning up to the
 * limit. Returns true if anything was dispatched.
 */
function pump(): boolean {
  let moved = false;
  while (queue.length) {
    const free = pool.find((s) => !s.busy) ?? (pool.length < poolLimit() ? spawn() : null);
    if (!free) break;
    dispatch(free, queue.shift()!);
    moved = true;
  }
  return moved;
}

/** Options for one worker call. */
export interface SimCallOptions {
  /** Per-call ceiling; the default is {@link SIM_TIMEOUT_MS}. */
  timeoutMs?: number;
  /**
   * Abort this call. A run still waiting for a worker is simply dropped; one
   * already in a worker terminates that worker, because `simulate()` is a
   * synchronous engine call and there is no other way to interrupt it.
   *
   * Either way the promise rejects with {@link SimCanceledError}.
   */
  signal?: AbortSignal;
  /**
   * Fired when the call leaves the queue and reaches a worker.
   *
   * With a pool, "submitted" and "running" stop being the same instant: a batch
   * of twelve is queued at once and starts four at a time. Callers that show
   * per-row state need the second event, and only the client knows it.
   */
  onStart?: () => void;
}

/**
 * Drop a task wherever it currently is.
 *
 * Queued: remove it from the line, and no worker is touched. Dispatched: kill
 * the worker running it, since a synchronous engine call cannot be interrupted
 * any other way. Already settled: nothing, so a late abort is harmless.
 */
function cancel(task: Queued): void {
  if (!live.has(task)) return;
  settle(task);
  const i = queue.indexOf(task);
  if (i >= 0) queue.splice(i, 1);
  if (task.slot) killWorker(task.slot, new SimCanceledError());
  else task.reject(new SimCanceledError());
}

/** Take a task out of the live set and detach its abort listener. */
function settle(task: Queued): void {
  live.delete(task);
  task.detach?.();
  task.detach = undefined;
}

/**
 * Typed per method: `call({ method: 'simulate', args })` resolves with a
 * `FlightResult`, `ping` with `'ok'`, from the protocol's own tables rather
 * than a `call<FlightResult>` cast at the public wrappers below.
 */
function call<M extends WorkerMethod>(
  c: Extract<WorkerCall, { method: M }>,
  opts: SimCallOptions = {},
): Promise<WorkerResults[M]> {
  return new Promise<WorkerResults[M]>((resolve, reject) => {
    const task: Queued = {
      call: c,
      timeoutMs: opts.timeoutMs,
      onStart: opts.onStart,
      // Wrapped so the task leaves the live set however it ends — a settled
      // task that stayed in it would let a later cancel kill a worker that has
      // moved on to somebody else's flight.
      // The transport carries `unknown`; the method's result type is what
      // the protocol promises for it, and the worker is the other half of
      // that contract.
      resolve: (v: unknown) => {
        settle(task);
        resolve(v as WorkerResults[M]);
      },
      reject: (e: Error) => {
        settle(task);
        reject(e);
      },
      slot: null,
      detach: undefined,
    };
    const signal = opts.signal;
    if (signal?.aborted) {
      reject(new SimCanceledError());
      return;
    }
    if (signal) {
      const onAbort = () => cancel(task);
      signal.addEventListener('abort', onAbort);
      task.detach = () => signal.removeEventListener('abort', onAbort);
    }
    live.add(task);
    queue.push(task);
    pump();
  });
}

/**
 * Ceiling on the warm-up ping. The worker answers only once its engine has
 * loaded (a WASM fetch + compile), so a stalled fetch behind a captive portal
 * or a wedged service worker would otherwise hold the slot `busy` forever: on
 * a two-core machine the pool is one slot, and every later sim sat in "queued"
 * with nothing to time it out. Generous, because a cold WASM load on a slow
 * phone is legitimately tens of seconds.
 */
const WARM_TIMEOUT_MS = 120_000;

/** Spawn + warm a worker (loads its engine) so the first sim isn't delayed. */
export function warmSimWorker(): void {
  void call({ method: 'ping', args: null }, { timeoutMs: WARM_TIMEOUT_MS }).catch(() => {
    /* warming is best-effort: a timed-out warm-up kills that worker and the
       first real sim spawns a fresh one */
  });
}

/** Run a flight simulation off the main thread. Rejects with the engine error
 *  message, or {@link SimTimeoutError} if the worker doesn't answer in time.
 *
 *  Several calls run CONCURRENTLY, up to the pool limit; the rest queue. */
export function simulateInWorker(payload: SimPayload, opts: SimCallOptions = {}): Promise<WorkerResults['simulate']> {
  return call({ method: 'simulate', args: payload }, { timeoutMs: SIM_TIMEOUT_MS, ...opts });
}

/** How many flights can be in the air at once on this machine.
 *
 *  Nothing in the app branches on it: the store submits the whole batch and lets
 *  the pool decide. It is exported so the sizing rule (a core left for the main
 *  thread, capped at {@link MAX_POOL}) can be asserted directly rather than only
 *  observed through how many workers happen to get spawned. */
export function simConcurrency(): number {
  return poolLimit();
}
