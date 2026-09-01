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
import type { SimPayload, WorkerRequest, WorkerResponse } from './simProtocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// Warm the worker's engine as soon as the module loads, so a `ping` (or the
// first `simulate`) doesn't pay the WASM/JS compile cost on the critical path.
const ready = initEngine();

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, method, args } = e.data;
  const reply = (r: WorkerResponse) => ctx.postMessage(r);
  try {
    await ready;
    if (method === 'ping') {
      reply({ id, ok: true, result: 'ok' });
      return;
    }
    if (method === 'simulate') {
      const { tree, motor, extraMotors, primaryIgnition, options } = args as SimPayload;
      // This worker only ever holds sim rockets; clear prior handles so the
      // engine's handle registry doesn't grow across runs.
      resetEngine();
      const design = buildConfiguredRocket(tree, motor, extraMotors, primaryIgnition);
      const result = design.simulate(options); // already a plain, cloneable object
      reply({ id, ok: true, result });
      return;
    }
    reply({ id, ok: false, error: `unknown method: ${String(method)}` });
  } catch (err) {
    reply({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
