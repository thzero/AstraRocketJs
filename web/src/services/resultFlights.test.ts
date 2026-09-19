import { describe, it, expect } from 'vitest';
import { resultFlight, type Simulation } from './simulations';
import type { FlightResult } from '../engine/openRocketEngine';

const flown = (id: string, name: string, apogee: number): Simulation =>
  ({ id, name, result: { summary: { maxAltitude: apogee } } as unknown as FlightResult }) as Simulation;
const neverRun = (id: string, name: string): Simulation => ({ id, name, result: null }) as Simulation;

const sims = [flown('a', 'C6', 100), flown('b', 'D12', 200), neverRun('c', 'Never run')];

/**
 * Which flight the Results tab draws.
 *
 * Deliberately NOT the Simulations table's tick boxes: those answer "which rows
 * should Run fly", and sharing one control meant reading a result silently
 * re-armed the Run button, or ticking rows to fly them yanked the charts around.
 */
describe('resultFlight', () => {
  it('follows the active simulation when nothing has been picked', () => {
    // The tab's behavior before the picker existed, and the right default: open
    // Results and you are reading the row you were just working on.
    expect(resultFlight(sims, null, 'b')?.name).toBe('D12');
  });

  it('draws the picked flight over the active one', () => {
    expect(resultFlight(sims, 'a', 'b')?.name).toBe('C6');
  });

  it('falls back when the pick has never flown', () => {
    // Its numbers do not exist yet; showing a chart frame with no data would
    // read as a bug rather than as a choice.
    expect(resultFlight(sims, 'c', 'a')?.name).toBe('C6');
  });

  it('falls back when the pick no longer names a simulation', () => {
    // Deleting the row you were reading lands you on the active one rather than
    // on an empty tab.
    expect(resultFlight(sims, 'gone', 'a')?.name).toBe('C6');
  });

  it('draws nothing when even the active row has not flown', () => {
    expect(resultFlight(sims, null, 'c')).toBeNull();
    expect(resultFlight([], null, 'a')).toBeNull();
  });

  it('carries the result itself, not just the name', () => {
    expect(resultFlight(sims, 'b', 'a')!.result.summary.maxAltitude).toBe(200);
  });
});
