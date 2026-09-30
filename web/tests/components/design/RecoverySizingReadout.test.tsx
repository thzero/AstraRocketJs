// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { RecoverySizingReadout } from '../../../src/components/design/RecoverySizingReadout';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useWorkspaceStore, selectActive } from '../../../src/state/store';
import type { ComponentNode, FlightResult, RocketTree } from '../../../src/engine/openRocketEngine';

/**
 * The block says which kind of number it is showing.
 *
 * Before a run every figure in it is the app's own arithmetic, which is fine as a
 * design aid and has to be labeled as one. Once a run has flown this device the
 * mass and the rate are the kernel's, and the label says so. The two suggested
 * diameters are marked an estimate either way: "what size should I use" is a
 * question about a design, and no flight answers it.
 */

const CHUTE = { id: 'chute', type: 'parachute', name: 'Main', diameter: 0.5, cd: 0.8 } as unknown as ComponentNode;

const TREE = {
  name: 'R',
  components: [
    {
      id: 'st',
      type: 'stage',
      name: 'Sustainer',
      children: [
        {
          id: 'tube',
          type: 'bodytube',
          length: 0.4,
          outerRadius: 0.026,
          thickness: 0.001,
          motorMount: true,
          children: [CHUTE],
        },
      ],
    },
  ],
} as unknown as RocketTree;

/** A loaded mass to subtract propellant from, so the ESTIMATE is computable. */
const INFO = { mass: 0.6, cg: 0.3, cp: 0.4, length: 0.5 } as never;

/** A config with one motor, so `descentMass` has propellant to subtract. */
const CONFIG = {
  id: 'c1',
  name: 'C6',
  motors: { tube: { spec: { designation: 'C6', masses: [0.024, 0.011] } } },
} as never;

/** A run in which "Main" opened at 5 s and settled at 5.5 m/s under it. */
const RESULT = (branchName: string): FlightResult =>
  ({
    summary: {},
    events: [
      { type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 5, source: 'Main' },
      { type: 'GROUND_HIT', time: 25 },
    ],
    series: { time: [0, 5, 25], mass: [0.6, 0.44, 0.44], velocity: [0, -2, -5.5] },
    ...(branchName
      ? {
          branches: [
            {
              name: branchName,
              events: [
                { type: 'RECOVERY_DEVICE_DEPLOYMENT', time: 5, source: 'Main' },
                { type: 'GROUND_HIT', time: 25 },
              ],
              series: { time: [0, 5, 25], mass: [0.6, 0.44, 0.44], velocity: [0, -2, -5.5] },
            },
            { name: 'Booster', events: [], series: { time: [0], mass: [0.2], velocity: [0] } },
          ],
        }
      : {}),
  }) as unknown as FlightResult;

function seed(opts: { result?: FlightResult | null; outdated?: boolean } = {}): void {
  const s = useWorkspaceStore.getState();
  const [first] = s.sims;
  useWorkspaceStore.setState({
    tree: TREE,
    info: INFO,
    configs: [CONFIG],
    sims: [{ ...first!, configId: 'c1', result: opts.result ?? null, outdated: opts.outdated ?? false }],
  });
  // The panel reads the ACTIVE simulation, so make sure the seeded row is it.
  useWorkspaceStore.setState({ activeId: selectActive(useWorkspaceStore.getState()).id });
}

const body = () => document.body.textContent ?? '';

describe('the descent-sizing block', () => {
  beforeEach(() => seed());

  it('says the figures are estimated when nothing has flown', () => {
    renderWithProviders(<RecoverySizingReadout node={CHUTE} />);
    expect(body()).toMatch(/Estimated for a descent mass/);
    expect(body()).not.toMatch(/Measured in the last run/);
  });

  it('always marks the suggested diameters as estimates', () => {
    renderWithProviders(<RecoverySizingReadout node={CHUTE} />);
    expect(body()).toMatch(/Diameters are estimates to design against/);
  });

  it('reports the kernel figures once the device has flown', () => {
    seed({ result: RESULT('') });
    renderWithProviders(<RecoverySizingReadout node={CHUTE} />);
    expect(body()).toMatch(/Measured in the last run/);
    // The kernel's 0.44 kg, not the estimate's 0.6 less the propellant.
    expect(screen.getByText(/440/)).toBeTruthy();
    // And its settled rate, not the descent equation's answer.
    expect(body()).toMatch(/5\.5/);
  });

  it('names the branch when the flight had more than one', () => {
    seed({ result: RESULT('Sustainer') });
    renderWithProviders(<RecoverySizingReadout node={CHUTE} />);
    expect(body()).toMatch(/Measured in the last run on Sustainer/);
  });

  /**
   * An outdated run describes a design or settings that have since moved, so the
   * estimate is the honest fallback rather than numbers from a rocket that is no
   * longer on screen.
   */
  it('falls back to the estimate when the run is outdated', () => {
    seed({ result: RESULT(''), outdated: true });
    renderWithProviders(<RecoverySizingReadout node={CHUTE} />);
    expect(body()).toMatch(/Estimated for a descent mass/);
  });

  /** A run that flew a DIFFERENT chute says nothing about this one. */
  it('stays an estimate for a device the run never deployed', () => {
    seed({ result: RESULT('') });
    const other = { ...CHUTE, id: 'other', name: 'Drogue' } as unknown as ComponentNode;
    renderWithProviders(<RecoverySizingReadout node={other} />);
    expect(body()).toMatch(/Estimated for a descent mass/);
  });
});
