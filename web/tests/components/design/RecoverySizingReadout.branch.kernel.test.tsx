// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { RecoverySizingReadout } from '../../../src/components/design/RecoverySizingReadout';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { selectActive, useWorkspaceStore } from '../../../src/state/store';
import { asFlown } from '../../testing/flown';
import { loadEngine } from '../../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import en from '../../../src/i18n/locales/en.json';
import type { ComponentNode, FlightResult, RocketTree } from '../../../src/engine/openRocketEngine';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The descent-sizing block names the stage branch a chute was measured on. The
 * branch names are the kernel's, through the bridge: a stage whose Name field
 * was cleared flies under the kernel's default, and the block has to name it the
 * way the app names a stage, never as the raw key.
 */

afterEach(cleanup);

const stageTree = (sustainer: string, booster: string): RocketTree =>
  ({
    name: 'TwoStage',
    components: [
      {
        id: 'sus',
        type: 'stage',
        name: sustainer,
        children: [
          { id: 'sn', type: 'nosecone', length: 0.07, aftRadius: 0.012, thickness: 0.002 },
          {
            id: 'sb',
            type: 'bodytube',
            length: 0.3,
            outerRadius: 0.012,
            thickness: 0.0003,
            density: 950,
            children: [
              {
                id: 'sf',
                type: 'trapezoidfinset',
                finCount: 3,
                rootChord: 0.05,
                tipChord: 0.03,
                sweep: 0.02,
                height: 0.025,
                thickness: 0.003,
              },
              {
                id: 'sustainer-mount',
                type: 'innertube',
                length: 0.07,
                outerRadius: 0.0095,
                thickness: 0.0005,
                motorMount: true,
                position: { method: 'bottom', offset: 0 },
              },
              { id: 'sustainer-chute', type: 'parachute', diameter: 0.35 },
            ],
          },
        ],
      },
      {
        id: 'boo',
        type: 'stage',
        name: booster,
        separationEvent: 'burnout',
        children: [
          {
            id: 'bb',
            type: 'bodytube',
            length: 0.12,
            outerRadius: 0.012,
            thickness: 0.0003,
            density: 950,
            children: [
              {
                id: 'bf',
                type: 'trapezoidfinset',
                finCount: 3,
                rootChord: 0.05,
                tipChord: 0.03,
                sweep: 0.025,
                height: 0.035,
                thickness: 0.003,
              },
              {
                id: 'booster-mount',
                type: 'innertube',
                length: 0.07,
                outerRadius: 0.0095,
                thickness: 0.0005,
                motorMount: true,
                position: { method: 'bottom', offset: 0 },
              },
              { id: 'booster-chute', type: 'parachute', diameter: 0.25 },
            ],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

async function fly(tree: RocketTree): Promise<FlightResult> {
  const engine = await loadEngine();
  engine.reset();
  const h = engine.buildRocket(JSON.stringify(tree));
  const times = [0, 0.1, 0.3, 0.5, 1.0, 1.5, 1.85, 2.0];
  const thrusts = [0, 12.0, 6.0, 5.1, 4.9, 4.8, 4.5, 0];
  const masses = [0.024, 0.0231, 0.0215, 0.0202, 0.0174, 0.0147, 0.0133, 0.0132];
  engine.setMotorById(h, 'sustainer-mount', 'C6', 0.018, 0.07, times, thrusts, masses, 0.035, 5);
  engine.setMotorById(h, 'booster-mount', 'C6', 0.018, 0.07, times, thrusts, masses, 0.035, 0);
  engine.setMotorIgnitionById(h, 'sustainer-mount', 'burnout', 1);
  return JSON.parse(engine.simulateJson(h, JSON.stringify({ launchRodLength: 1, randomSeed: 7 }))) as FlightResult;
}

/** Plant the flight as the active simulation's current result. */
function plant(tree: RocketTree, result: FlightResult) {
  const s = useWorkspaceStore.getState();
  const [first] = s.sims;
  const spec = { designation: 'C6', masses: [0.024, 0.0132] };
  useWorkspaceStore.setState({
    tree,
    info: { mass: 0.2, cg: 0.2, cp: 0.3, length: 0.49 } as never,
    configs: [
      {
        id: 'c1',
        name: 'C6',
        motors: { 'sustainer-mount': { spec }, 'booster-mount': { spec } },
      } as never,
    ],
    sims: [{ ...first!, configId: 'c1', result, resultKey: undefined }],
  });
  useWorkspaceStore.setState((st) => ({ sims: st.sims.map((x) => asFlown(st, x)) }));
  useWorkspaceStore.setState({ activeId: selectActive(useWorkspaceStore.getState()).id });
}

/** The block's measured-on line for one chute. */
function measuredLine(tree: RocketTree, chuteId: string): string {
  const chute = tree.components
    .flatMap((st) => st.children ?? [])
    .flatMap((b) => b.children ?? [])
    .find((n) => n.id === chuteId) as ComponentNode;
  renderWithProviders(<RecoverySizingReadout node={chute} onChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Descent sizing…' }));
  return screen.getByText(/Measured in the last run/).textContent ?? '';
}

/** The kernel's branch index and name for the branch a chute deployed on. */
function deployedOn(result: FlightResult, chuteId: string): { index: number; name: string } {
  const branches = result.branches ?? [];
  const index = branches.findIndex((b) =>
    (b.events ?? []).some((e) => e.type === 'RECOVERY_DEVICE_DEPLOYMENT' && e.sourceId === chuteId),
  );
  return { index, name: branches[index]?.name ?? '' };
}

describe('the descent-sizing block on a staged flight', () => {
  it.each(['sustainer-chute', 'booster-chute'])(
    'names a cleared stage by its place for the %s, never by the kernel key',
    async (chuteId) => {
      const tree = stageTree('', '');
      const result = await fly(tree);
      expect(result.branches?.length).toBeGreaterThan(1);
      const on = deployedOn(result, chuteId);
      expect(on.index).toBeGreaterThanOrEqual(0);
      // The kernel's own name for the cleared stage is its default key.
      expect(on.name).toMatch(/^\[.+\]$/);
      plant(tree, result);
      const line = measuredLine(tree, chuteId);
      expect(line).not.toContain(on.name);
      expect(line).toContain(en.flight.stageN.replace('{{n}}', String(on.index + 1)));
    },
  );

  it.each(['sustainer-chute', 'booster-chute'])('keeps a stage name the user typed for the %s', async (chuteId) => {
    const tree = stageTree('Upper', 'Lower');
    const result = await fly(tree);
    const on = deployedOn(result, chuteId);
    // The kernel flies the typed names.
    expect(['Upper', 'Lower']).toContain(on.name);
    plant(tree, result);
    expect(measuredLine(tree, chuteId)).toContain(`on ${on.name},`);
  });
});
