import type { MotorSpec, RocketTree, SimulationOptions } from './openRocketEngine';
import type { MountMotor } from '../services/loadOrk';

/**
 * Shared message contract between the main thread (engine/simClient.ts) and the
 * sim worker (engine/simWorker.ts). Types only — importing this pulls no code
 * into either side, so the worker never imports the client (which would spawn a
 * nested worker) and vice-versa.
 *
 * The transport is a generic method-dispatch RPC (`{id, method, args}` →
 * `{id, ok, …}`) rather than a bespoke "simulate" message, so later phases can
 * add operations (dragSweep, staticInfo — see docs/engine-worker-proposal.md)
 * without touching the plumbing.
 */
export interface SimPayload {
  tree: RocketTree;
  motor: MotorSpec | undefined;
  extraMotors: Record<string, MountMotor>;
  options: SimulationOptions;
}

export interface WorkerRequest {
  id: number;
  method: 'ping' | 'simulate';
  args: SimPayload | null;
}

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
