/**
 * Main-thread client for the sim worker (engine/simWorker.ts). Owns the worker,
 * correlates requests/responses by id, and exposes a small typed surface. The
 * transport is a generic RPC so future phases can add methods without changing
 * this plumbing (see docs/engine-worker-proposal.md).
 */
import type { FlightResult } from './openRocketEngine';
import type { SimPayload, WorkerRequest, WorkerResponse } from './simProtocol';

/** Hard ceiling for a single worker call. A flight sim is normally well under a
 *  second; if the engine hangs (degenerate geometry, an integrator that never
 *  converges) the worker's message loop is blocked, so no amount of waiting
 *  recovers it — the call must time out and the worker be killed. Generous
 *  enough that a legitimately heavy sim never trips it. */
const SIM_TIMEOUT_MS = 30_000;

/** Rejection thrown when a worker call exceeds its timeout and the worker is
 *  terminated. Distinct type so callers can show a "timed out" message rather
 *  than a raw engine error. */
export class SimTimeoutError extends Error {
  constructor() {
    super('sim timed out');
    this.name = 'SimTimeoutError';
  }
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

/** Terminate the worker and fail everything in flight. Used for both a hard
 *  crash and a timeout — in either case the worker is unusable, so we drop it
 *  and let the next call spawn a fresh one. */
function killWorker(err: Error): void {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
  worker?.terminate();
  worker = null;
}

function getWorker(): Worker {
  if (worker) return worker;
  // Vite compiles this to a hashed worker chunk via the new URL(...) form.
  worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  };
  worker.onerror = (e) => {
    killWorker(new Error(e.message || 'sim worker crashed'));
  };
  return worker;
}

function call<T>(method: WorkerRequest['method'], args: WorkerRequest['args'], timeoutMs?: number): Promise<T> {
  const w = getWorker();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    // On timeout the worker is hung mid-call and can't be interrupted, so kill
    // it — that rejects this promise (still in `pending`) via the wrapper below.
    const timer = timeoutMs && timeoutMs > 0
      ? setTimeout(() => killWorker(new SimTimeoutError()), timeoutMs)
      : undefined;
    pending.set(id, {
      resolve: (v: unknown) => { clearTimeout(timer); (resolve as (x: unknown) => void)(v); },
      reject: (err: Error) => { clearTimeout(timer); reject(err); },
    });
    w.postMessage({ id, method, args } satisfies WorkerRequest);
  });
}

/** Spawn + warm the worker (loads its engine) so the first sim isn't delayed. */
export function warmSimWorker(): void {
  void call('ping', null).catch(() => { /* warming is best-effort */ });
}

/** Run a flight simulation off the main thread. Rejects with the engine error
 *  message, or {@link SimTimeoutError} if the worker doesn't answer in time. */
export function simulateInWorker(payload: SimPayload, timeoutMs = SIM_TIMEOUT_MS): Promise<FlightResult> {
  return call<FlightResult>('simulate', payload, timeoutMs);
}
