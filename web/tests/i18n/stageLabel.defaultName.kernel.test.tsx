// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import * as saveFile from '../../src/services/files/saveFile';
import i18n from '../../src/i18n';
import { stageLabel } from '../../src/i18n/format';
import { buildTraces } from '../../src/components/canvas/flightChartTraces';
import { FlightChart } from '../../src/components/canvas/FlightChart';
import { EnvironmentLanding } from '../../src/components/canvas/EnvironmentLanding';
import { FlightEventsTable } from '../../src/components/sim/FlightEventsTable';
import { FlightCsvDialog } from '../../src/components/sim/FlightCsvDialog';
import { exportBranchNames } from '../../src/services/exports/flightPathExport';
import type { FlightResult } from '../../src/engine/openRocketEngine';
import type { ResultFlight } from '../../src/services/flight/simulations';
import { renderWithProviders } from '../testing/renderWithProviders';
import { loadEngine } from '../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A two-stage flight whose stages were never named. The kernel names each
 * branch after its stage, and a stage with a cleared name takes its default,
 * AxialStage.getComponentName (AxialStage.java:41), `trans.get("Stage.Stage")`,
 * which TeaVM returns as the bracketed key. Every view that names a stage has
 * to read that as no name and say "Stage n".
 */

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
const mount = (id: string) => ({
  id,
  type: 'innertube',
  length: 0.07,
  outerRadius: 0.0095,
  thickness: 0.0005,
  motorMount: true,
  position: { method: 'bottom', offset: 0 },
});

const TREE = {
  name: 'Unnamed stages',
  components: [
    {
      id: 'up',
      type: 'stage',
      name: '',
      children: [
        { id: 'n', type: 'nosecone', length: 0.07, aftRadius: 0.012, thickness: 0.002 },
        {
          id: 'ub',
          type: 'bodytube',
          length: 0.3,
          outerRadius: 0.012,
          thickness: 0.0003,
          children: [fins('uf'), mount('upper-mount'), { id: 'uc', type: 'parachute', diameter: 0.35 }],
        },
      ],
    },
    {
      id: 'kick',
      type: 'stage',
      name: '',
      separationEvent: 'burnout',
      children: [
        {
          id: 'kb',
          type: 'bodytube',
          length: 0.12,
          outerRadius: 0.012,
          thickness: 0.0003,
          children: [fins('kf'), mount('kick-mount'), { id: 'kc', type: 'parachute', diameter: 0.25 }],
        },
      ],
    },
  ],
};

let flown: FlightResult | null = null;
async function fly(): Promise<FlightResult> {
  if (flown) return flown;
  const engine = await loadEngine();
  engine.reset();
  const h = engine.buildRocket(JSON.stringify(TREE));
  const times = [0, 0.1, 0.3, 0.5, 1.0, 1.5, 1.85, 2.0];
  const thrusts = [0, 12.0, 6.0, 5.1, 4.9, 4.8, 4.5, 0];
  const masses = [0.024, 0.0231, 0.0215, 0.0202, 0.0174, 0.0147, 0.0133, 0.0132];
  engine.setMotorById(h, 'upper-mount', 'C6', 0.018, 0.07, times, thrusts, masses, 0.035, 5);
  engine.setMotorById(h, 'kick-mount', 'C6', 0.018, 0.07, times, thrusts, masses, 0.035, 0);
  engine.setMotorIgnitionById(h, 'upper-mount', 'burnout', 1);
  flown = JSON.parse(engine.simulateJson(h, JSON.stringify({ rodLength: 1, randomSeed: 7 }))) as FlightResult;
  return flown;
}

const t = i18n.t.bind(i18n) as unknown as (key: string, opts?: Record<string, unknown>) => string;
const numbered = (n: number) => Array.from({ length: n }, (_, i) => t('flight.stageN', { n: i + 1 }));

afterEach(cleanup);

describe('a flight whose stages the user never named', () => {
  it('carries the kernel default name on every branch', async () => {
    const result = await fly();
    const names = (result.branches ?? []).map((b) => b.name);
    expect(names.length).toBeGreaterThan(1);
    // The stage's default, as the kernel returns it with no resource bundle.
    for (const name of names) expect(name).toBe(`[${'Stage.Stage'}]`);
  });

  it('is labeled Stage n by stageLabel', async () => {
    const result = await fly();
    expect(result.branches!.map((b, i) => stageLabel(t, i, b.name))).toEqual(numbered(result.branches!.length));
  });

  it('names each chart trace Stage n', async () => {
    const result = await fly();
    const traces = buildTraces({ id: 's1', name: 'Sim', result }, (i, name) => stageLabel(t, i, name));
    expect(traces.map((x) => x.name)).toEqual(numbered(result.branches!.length));
  });

  it('names each stage chip on the flight chart Stage n', async () => {
    const result = await fly();
    renderWithProviders(<FlightChart flight={{ id: 's1', name: 'Sim', result }} />);
    for (const name of numbered(result.branches!.length)) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\[Stage\./)).toBeNull();
  });

  it('names each flight path export branch Stage n', async () => {
    const result = await fly();
    const names = exportBranchNames(result, { simName: 'Sim', rocketName: 'R', motorName: 'C6' }, t);
    expect(names).toEqual(numbered(names.length));
    expect(names.length).toBeGreaterThan(1);
  });

  it('names the stage of each event row Stage n', async () => {
    const result = await fly();
    renderWithProviders(<FlightEventsTable sim={result} simName="Sim" />);
    const section = screen.getByRole('region', { name: t('flight.events') });
    expect(within(section).getAllByText(t('flight.stageN', { n: 2 })).length).toBeGreaterThan(0);
    expect(section.textContent).not.toMatch(/\[[A-Za-z]+\.[A-Za-z]+\]/);
  });

  it('writes no kernel default name into the events CSV', async () => {
    const result = await fly();
    const spy = vi.spyOn(saveFile, 'download').mockImplementation(() => {});
    renderWithProviders(<FlightEventsTable sim={result} simName="Sim" />);
    fireEvent.click(screen.getByTitle(t('flight.eventsCsv')));
    const csv = spy.mock.calls[0]![1] as string;
    spy.mockRestore();
    expect(csv).toContain(t('flight.stageN', { n: 2 }));
    expect(csv).not.toMatch(/\[[A-Za-z]+\.[A-Za-z]+\]/);
  });

  it('offers each stage in the CSV dialog as Stage n', async () => {
    const result = await fly();
    renderWithProviders(<FlightCsvDialog result={result} simName="Sim" onClose={() => {}} />);
    const select = screen.getByRole('combobox', { name: t('csv.stage') });
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(numbered(result.branches!.length));
  });

  it('names each stage landing row Stage n', async () => {
    const result = await fly();
    const flight = {
      id: 's1',
      name: 'Sim',
      result,
      launch: { latitudeDeg: 39.7392, longitudeDeg: -104.9903 },
    } as unknown as ResultFlight;
    renderWithProviders(<EnvironmentLanding flight={flight} />);
    for (const stage of numbered(result.branches!.length))
      expect(screen.getByText(t('env.landing.stageLands', { stage }))).toBeTruthy();
  });
});
