/**
 * Main-thread client for the sim worker (engine/simWorker.ts). Owns the worker,
 * correlates requests/responses by id, and exposes a small typed surface. The
 * transport is a generic RPC so future phases can add methods without changing
 * this plumbing (see docs/engine-worker-proposal.md).
 */
import type { FlightResult } from './openRocketEngine';
import type { SimPayload, WorkerRequest, WorkerResponse } from './simProtocol';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

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
    // A hard worker crash rejects everything in flight; drop the dead worker so
    // the next call spawns a fresh one.
    const err = new Error(e.message || 'sim worker crashed');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function call<T>(method: WorkerRequest['method'], args: WorkerRequest['args']): Promise<T> {
  const w = getWorker();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, method, args } satisfies WorkerRequest);
  });
}

/** Spawn + warm the worker (loads its engine) so the first sim isn't delayed. */
export function warmSimWorker(): void {
  void call('ping', null).catch(() => { /* warming is best-effort */ });
}

/** Run a flight simulation off the main thread. Rejects with the engine error message. */
export function simulateInWorker(payload: SimPayload): Promise<FlightResult> {
  return call<FlightResult>('simulate', payload);
}
