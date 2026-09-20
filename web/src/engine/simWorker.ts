/// <reference lib="webworker" />
/**
 * Sim worker (Option B, Phase 1 — see docs/engine-worker-proposal.md). Runs the
 * heavy flight simulation on its own thread so a ~500 ms sim never freezes the
 * UI. It loads its OWN engine instance (WASM-GC, JS fallback) — independent of
 * the main thread's — and, on each `simulate` request, rebuilds the rocket from
 * the posted tree and runs it. The kernel's per-flight INFO logging goes to this
 * worker's log sink (kernelLogSink, imported transitively), off the main console.
 */
import { initEngine, resetEngine } from './openRocketEngine';
import { buildConfiguredRocket } from '../services/buildRocket';
import type { WorkerRequest, WorkerResponse } from './simProtocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/**
 * The engine load, started by the FIRST request (which carries the backend
 * preference the main thread resolved: `?engine=` and localStorage do not
 * exist in a worker, so `backendPref()` here would always say `auto`).
 * `warmSimWorker` pings right after spawning, so this still runs ahead of the
 * first real flight.
 *
 * It never rejects. A module-level `const ready = initEngine()` whose rejection
 * nobody caught was an unhandled rejection in the worker, and the worker then
 * sat in the pool answering every request with "engine not initialized" until
 * its idle reaper got to it. The failure is kept and reported on each request
 * as `fatal`, which is the client's cue to terminate and replace this worker.
 */
let ready: Promise<void> | null = null;
let fatal: string | null = null;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const id = req.id;
  const reply = (r: WorkerResponse) => ctx.postMessage(r);
  ready ??= initEngine(undefined, req.engine).then(
    () => undefined,
    (err: unknown) => {
      fatal = `sim worker engine failed to load: ${message(err)}`;
    },
  );
  try {
    await ready;
    if (fatal) {
      reply({ id, ok: false, error: fatal, fatal: true });
      return;
    }
    switch (req.method) {
      case 'ping':
        reply({ id, ok: true, result: 'ok' });
        return;
      case 'simulate': {
        // Narrowed by the discriminated union, not cast: `req.args` IS a
        // SimPayload here and nothing else.
        const { tree, motor, extraMotors, primaryIgnition, options } = req.args;
        // This worker only ever holds sim rockets; clear prior handles so the
        // engine's handle registry doesn't grow across runs.
        resetEngine();
        const design = buildConfiguredRocket(tree, motor, extraMotors, primaryIgnition);
        const result = design.simulate(options); // already a plain, cloneable object
        reply({ id, ok: true, result });
        return;
      }
      default:
        reply({ id, ok: false, error: `unknown method: ${String((req as { method: unknown }).method)}` });
    }
  } catch (err) {
    reply({ id, ok: false, error: message(err) });
  }
};
