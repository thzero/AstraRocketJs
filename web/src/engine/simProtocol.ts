import type { BackendPref, FlightResult, RocketTree, SimulationOptions } from './openRocketEngine';
import type { FlightConfig } from '../services/flight/flightConfigs';
import type { Keyed } from '../i18n/keyedError';

/**
 * Shared message contract between the main thread (engine/simClient.ts) and the
 * sim worker (engine/simWorker.ts). Types only: importing this pulls no code
 * into either side, so the worker never imports the client (which would spawn a
 * nested worker) and vice-versa.
 *
 * The transport is a generic method-dispatch RPC (`{id, method, args}` →
 * `{id, ok, …}`) rather than a bespoke "simulate" message, so further
 * operations can be added without touching the plumbing.
 *
 * The request is a discriminated union on `method`, and each method names its
 * result type in {@link WorkerResults}. One shape with `args: SimPayload | null`
 * and `result: unknown` instead would force a cast on both sides, and let a new
 * method be wired up with the wrong payload without a compile error.
 */
export interface SimPayload {
  tree: RocketTree;
  /** The flight configuration to seat: one motor per mount, with its ignition. */
  config: FlightConfig;
  options: SimulationOptions;
  /**
   * The length unit this flight's airframe-step warnings are decided in
   * (`setKernelLengthUnit`). Carried per flight so the worker never relies on
   * the main thread's unit, which only its own build updates. Absent, the
   * request's `lengthUnit` applies.
   */
  lengthUnit?: string;
}

/** One call, without its correlation id: the method and its typed arguments. */
export type WorkerCall = { method: 'ping'; args: null } | { method: 'simulate'; args: SimPayload };

export type WorkerMethod = WorkerCall['method'];

/** The result each method resolves with. */
export interface WorkerResults {
  ping: 'ok';
  simulate: FlightResult;
}

/** `engine` is which backend the worker should load. It is resolved on the
 *  main thread (`?engine=` / localStorage), which a worker cannot read, and
 *  carried on every request so the first one to arrive can start the engine.
 *  `lengthUnit` is the user's length unit, which the kernel's airframe-step
 *  warnings are worded and decided in (`setKernelLengthUnit`). */
export type WorkerRequest = { id: number; engine: BackendPref; lengthUnit: string } & WorkerCall;

/**
 * Posted once, unprompted, when the worker's engine has loaded. A call's own
 * timeout runs from here: before it, the worker is loading rather than flying,
 * and a cold WASM load on a slow phone takes tens of seconds.
 */
export interface WorkerReady {
  ready: true;
}

export type WorkerResponse<M extends WorkerMethod = WorkerMethod> =
  | { id: number; ok: true; result: WorkerResults[M] }
  | {
      id: number;
      ok: false;
      /** The failure in English, for logs and for a failure that carries no key. */
      error: string;
      /**
       * The failure's i18n key and values, when the worker threw a
       * `KeyedError`. The client checks its shape on receipt and rebuilds the
       * error from it, so the user reads it in the app's language.
       */
      keyed?: Keyed;
      /**
       * The worker cannot serve any request: its engine failed to load. The
       * client terminates and replaces it rather than leaving a dead worker in
       * the pool answering every call with the same error.
       */
      fatal?: true;
    };
