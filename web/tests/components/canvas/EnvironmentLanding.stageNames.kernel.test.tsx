// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { EnvironmentLanding } from '../../../src/components/canvas/EnvironmentLanding';
import { buildTraces } from '../../../src/components/canvas/flightChartTraces';
import { stageLabel } from '../../../src/i18n/format';
import type { FlightResult } from '../../../src/engine/openRocketEngine';
import type { ResultFlight } from '../../../src/services/flight/simulations';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * Each stage's landing row names the stage as the ground track and the flight
 * chart name its branch: the name the kernel gives the branch, which is the
 * stage's own name. The flight is the kernel's, through the bridge.
 */

const stage = (id: string, name: string, extra: Record<string, unknown>, children: unknown[]) => ({
  id,
  type: 'stage',
  name,
  ...extra,
  children,
});
const mount = (id: string) => ({
  id,
  type: 'innertube',
  length: 0.07,
  outerRadius: 0.0095,
  thickness: 0.0005,
  motorMount: true,
  position: { method: 'bottom', offset: 0 },
});
const fins = (id: string) => ({
  id,
  type: 'trapezoidfinset',
  finCount: 3,
  rootChord: 0.05,
  tipChord: 0.03,
  sweep: 0.02,
  height: 0.03,
  thickness: 0.003,
});

const TREE = {
  name: 'TwoStage',
  components: [
    stage('up', 'Upper', {}, [
      { id: 'n', type: 'nosecone', length: 0.07, aftRadius: 0.012, thickness: 0.002 },
      {
        id: 'ub',
        type: 'bodytube',
        length: 0.3,
        outerRadius: 0.012,
        thickness: 0.0003,
        children: [fins('uf'), mount('upper-mount'), { id: 'uc', type: 'parachute', diameter: 0.35 }],
      },
    ]),
    stage('kick', 'Kick', { separationEvent: 'burnout' }, [
      {
        id: 'kb',
        type: 'bodytube',
        length: 0.12,
        outerRadius: 0.012,
        thickness: 0.0003,
        children: [fins('kf'), mount('kick-mount'), { id: 'kc', type: 'parachute', diameter: 0.25 }],
      },
    ]),
  ],
};

async function fly(): Promise<FlightResult> {
  const engine = await loadEngine();
  engine.reset();
  const h = engine.buildRocket(JSON.stringify(TREE));
  const times = [0, 0.1, 0.3, 0.5, 1.0, 1.5, 1.85, 2.0];
  const thrusts = [0, 12.0, 6.0, 5.1, 4.9, 4.8, 4.5, 0];
  const masses = [0.024, 0.0231, 0.0215, 0.0202, 0.0174, 0.0147, 0.0133, 0.0132];
  engine.setMotorById(h, 'upper-mount', 'C6', 0.018, 0.07, times, thrusts, masses, 0.035, 5);
  engine.setMotorById(h, 'kick-mount', 'C6', 0.018, 0.07, times, thrusts, masses, 0.035, 0);
  engine.setMotorIgnitionById(h, 'upper-mount', 'burnout', 1);
  return JSON.parse(engine.simulateJson(h, JSON.stringify({ launchRodLength: 1, randomSeed: 7 }))) as FlightResult;
}

afterEach(cleanup);

describe('the landing rows of a staged flight', () => {
  it('name each stage as the ground track names its branch', async () => {
    const result = await fly();
    const names = (result.branches ?? []).map((b) => b.name);
    // The kernel's branch names are the stages' own.
    expect(result.branches?.map((b) => b.name)).toContain('Kick');
    const flight = {
      id: 's1',
      name: 'Sim',
      result,
      launch: { latitudeDeg: 39.7392, longitudeDeg: -104.9903 },
    } as unknown as ResultFlight;
    renderWithProviders(<EnvironmentLanding flight={flight} />);
    const t = (k: string, o?: Record<string, unknown>) => (k === 'flight.stageN' ? `Stage ${String(o?.['n'])}` : k);
    const traces = buildTraces({ id: 's1', result } as never, (i, name) => stageLabel(t, i, name));
    expect(traces.length).toBeGreaterThan(1);
    for (const trace of traces) {
      expect(names).toContain(trace.name);
      expect(screen.getByText(`${trace.name} lands at`)).toBeTruthy();
    }
  });
});
