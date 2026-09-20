import type { FlightResult, MotorSpec, RocketTree, SimulationOptions } from './openRocketEngine';
import type { MountMotor } from '../services/loadOrk';
import type { Ignition } from '../services/buildRocket';

/**
 * Shared message contract between the main thread (engine/simClient.ts) and the
 * sim worker (engine/simWorker.ts). Types only — importing this pulls no code
 * into either side, so the worker never imports the client (which would spawn a
 * nested worker) and vice-versa.
 *
 * The transport is a generic method-dispatch RPC (`{id, method, args}` →
 * `{id, ok, …}`) rather than a bespoke "simulate" message, so later phases can
 * add operations (aeroSweep, staticInfo — see docs/engine-worker-proposal.md)
 * without touching the plumbing.
 *
 * The request is a DISCRIMINATED UNION on `method`, and each method names its
 * result type in {@link WorkerResults}. It used to be one `{method: 'ping' |
 * 'simulate'; args: SimPayload | null}` shape with `result: unknown`, so the
 * worker cast `args as SimPayload` and the client cast the result to
 * `FlightResult`, and a new method could be wired up with the wrong payload on
 * either side without a compile error.
 */
export interface SimPayload {
  tree: RocketTree;
  motor: MotorSpec | undefined;
  extraMotors: Record<string, MountMotor>;
  /** Primary mount's ignition override (undefined = automatic). */
  primaryIgnition?: Ignition;
  options: SimulationOptions;
}

/** Which engine backend the worker should load. Resolved on the MAIN thread
 *  (`?engine=` / localStorage), which a worker cannot read, and carried on
 *  every request so the first one to arrive can start the engine. */
export type BackendPref = 'wasm' | 'js' | 'auto';

/** One call, without its correlation id: the method and its typed arguments. */
export type WorkerCall = { method: 'ping'; args: null } | { method: 'simulate'; args: SimPayload };

export type WorkerMethod = WorkerCall['method'];

/** The result each method resolves with. */
export interface WorkerResults {
  ping: 'ok';
  simulate: FlightResult;
}

export type WorkerRequest = { id: number; engine: BackendPref } & WorkerCall;

export type WorkerResponse<M extends WorkerMethod = WorkerMethod> =
  | { id: number; ok: true; result: WorkerResults[M] }
  | {
      id: number;
      ok: false;
      error: string;
      /**
       * The worker cannot serve ANY request: its engine failed to load. The
       * client terminates and replaces it rather than leaving a dead worker in
       * the pool answering every call with the same error.
       */
      fatal?: true;
    };
