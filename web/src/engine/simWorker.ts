/// <reference lib="webworker" />
/**
 * Sim worker. Runs the heavy flight simulation on its own thread so a ~500 ms sim never freezes the
 * UI. It loads its own engine instance (WASM-GC, JS fallback), independent of
 * the main thread's, and, on each `simulate` request, rebuilds the rocket from
 * the posted tree and runs it. The kernel's per-flight INFO logging goes to this
 * worker's log sink (kernelLogSink, imported transitively), off the main console.
 */
import { initEngine, resetEngine, setKernelLengthUnit } from './openRocketEngine';
import { buildConfiguredRocket } from '../services/design/buildRocket';
import type { WorkerReady, WorkerRequest, WorkerResponse } from './simProtocol';
import { errorMessage } from '../services/app/errorMessage';
import { errorReason, KeyedError } from '../i18n/keyedError';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/**
 * The engine load, started by the first request (which carries the backend
 * preference the main thread resolved: `?engine=` and localStorage do not
 * exist in a worker, so `backendPref()` here would always say `auto`).
 * `warmSimWorker` pings right after spawning, so this still runs ahead of the
 * first real flight.
 *
 * It never rejects. An uncaught rejection here would be an unhandled rejection
 * in the worker, which would then sit in the pool answering every request with
 * "engine not initialized" until its idle reaper got to it. The failure is kept
 * and reported on each request as `fatal`, which is the client's cue to
 * terminate and replace this worker.
 */
let ready: Promise<void> | null = null;
let fatal: KeyedError | null = null;

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const id = req.id;
  const reply = (r: WorkerResponse) => ctx.postMessage(r);
  // A keyed error crosses as its key and values, so the main thread can show it
  // in the user's language; `error` is the English text, for logs.
  const fail = (err: unknown, isFatal?: true) =>
    reply({
      id,
      ok: false,
      error: errorMessage(err),
      ...(err instanceof KeyedError
        ? { keyed: err.values ? { key: err.key, values: err.values } : { key: err.key } }
        : {}),
      ...(isFatal ? { fatal: isFatal } : {}),
    });
  ready ??= initEngine(undefined, req.engine).then(
    () => {
      ctx.postMessage({ ready: true } satisfies WorkerReady);
    },
    (err: unknown) => {
      fatal = new KeyedError('errors.sim.engineLoad', { reason: errorReason(err) });
    },
  );
  try {
    await ready;
    if (fatal) {
      fail(fatal, true);
      return;
    }
    switch (req.method) {
      case 'ping':
        reply({ id, ok: true, result: 'ok' });
        return;
      case 'simulate': {
        // Narrowed by the discriminated union, not cast: `req.args` is a
        // SimPayload here and nothing else.
        const { tree, config, options, lengthUnit } = req.args;
        // The flight's airframe-step warnings, in the unit the app shows.
        setKernelLengthUnit(lengthUnit ?? req.lengthUnit);
        // This worker only ever holds sim rockets; clear prior handles so the
        // engine's handle registry doesn't grow across runs.
        resetEngine();
        const design = buildConfiguredRocket(tree, config);
        const result = design.simulate(options); // already a plain, cloneable object
        reply({ id, ok: true, result });
        return;
      }
      default:
        fail(new KeyedError('errors.sim.unknownMethod', { method: String((req as { method: unknown }).method) }));
    }
  } catch (err) {
    fail(err);
  }
};
