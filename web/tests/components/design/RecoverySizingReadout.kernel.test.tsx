// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { RecoverySizingReadout } from '../../../src/components/design/RecoverySizingReadout';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { selectActive, useWorkspaceStore } from '../../../src/state/store';
import { asFlown } from '../../testing/flown';
import { kernelComponentName } from '../../../src/services/app/warningText';
import { loadEngine } from '../../testing/kernelGeometry';
import { seriesAt } from '../../../src/services/flight/flightEvents';
import { KERNEL_TEST_TIMEOUT_MS } from '../../testing/kernelTimeout';
import {
  __setEngineForTests,
  type ComponentNode,
  type FlightResult,
  type RocketTree,
} from '../../../src/engine/openRocketEngine';
import { buildRocketTree } from '../../../src/engine/api';
import { airDensity, canopyDiameter, descentMass, MAIN_BAND } from '../../../src/services/flight/recoverySizing';
import { motorSpecs } from '../../../src/services/flight/flightConfigs';
import { fmtNum } from '../../../src/i18n/format';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * A chute the user never named still shows what the run measured under it.
 *
 * A part made in the app has no `name`, so the bridge leaves the kernel's own
 * default in place, and that default is what the deployment event carries as
 * its source. The flight here is the kernel's, through the bridge.
 */

const CHUTE = { id: 'chute', type: 'parachute', diameter: 0.4, cd: 0.8 } as unknown as ComponentNode;

/** A single-stage design with one motor mount, carrying `chute` as its recovery device. */
const treeWith = (chute: ComponentNode): RocketTree =>
  ({
    name: 'R',
    components: [
      {
        id: 'st',
        type: 'stage',
        name: 'Sustainer',
        children: [
          { id: 'n', type: 'nosecone', shape: 'ogive', length: 0.07, aftRadius: 0.013, thickness: 0.001 },
          {
            id: 'm',
            type: 'bodytube',
            length: 0.3,
            outerRadius: 0.013,
            thickness: 0.0005,
            motorMount: true,
            children: [
              {
                id: 'f',
                type: 'trapezoidfinset',
                finCount: 3,
                rootChord: 0.06,
                tipChord: 0.03,
                sweep: 0.03,
                height: 0.05,
                thickness: 0.003,
              },
              chute,
            ],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

const TREE = treeWith(CHUTE);

describe('the descent-sizing block on an unnamed chute', () => {
  it('reports the run figures the kernel recorded for it', async () => {
    const engine = await loadEngine();
    engine.reset();
    const h = engine.buildRocket(JSON.stringify(TREE));
    engine.setMotorById(h, 'm', 'C6', 0.018, 0.07, [0, 0.2, 1.8], [0, 14, 0], [0.024, 0.022, 0.012], 0.035, 3);
    const result = JSON.parse(
      engine.simulateJson(h, JSON.stringify({ launchRodLength: 1, randomSeed: 7 })),
    ) as FlightResult;
    // The run deployed the chute, under the kernel's default name.
    const opened = result.events.find((e) => e.type === 'RECOVERY_DEVICE_DEPLOYMENT');
    expect(opened?.source).toBe(kernelComponentName(CHUTE));

    const s = useWorkspaceStore.getState();
    const [first] = s.sims;
    useWorkspaceStore.setState({
      tree: TREE,
      info: { mass: 0.1, cg: 0.2, cp: 0.3, length: 0.37 } as never,
      configs: [
        { id: 'c1', name: 'C6', motors: { m: { spec: { designation: 'C6', masses: [0.024, 0.012] } } } } as never,
      ],
      sims: [{ ...first!, configId: 'c1', result, resultKey: undefined }],
    });
    useWorkspaceStore.setState((st) => ({ sims: st.sims.map((x) => asFlown(st, x)) }));
    useWorkspaceStore.setState({ activeId: selectActive(useWorkspaceStore.getState()).id });

    renderWithProviders(<RecoverySizingReadout node={CHUTE} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Descent sizing…' }));
    expect(document.body.textContent).toMatch(/Measured in the last run/);
  });

  /**
   * Two chutes the user never named both fly under the kernel's default name,
   * so a name cannot tell the main's deployment from the drogue's. The main's
   * block must show the descent under the main: the kernel's speed at the end of
   * the main's phase, which is the ground hit, not at the main's opening, which
   * is where the drogue's phase ends.
   */
  it('shows the main its own descent when the drogue is unnamed too', async () => {
    const engine = await loadEngine();
    engine.reset();
    const h = engine.buildRocket(JSON.stringify(DUAL_TREE));
    engine.setMotorById(h, 'm', 'C6', 0.018, 0.07, C6_TIMES, C6_THRUSTS, C6_MASSES, 0.035, 3);
    const result = JSON.parse(
      engine.simulateJson(h, JSON.stringify({ launchRodLength: 1, randomSeed: 7 })),
    ) as FlightResult;
    const deployments = result.events.filter((e) => e.type === 'RECOVERY_DEVICE_DEPLOYMENT');
    // The drogue opens first, at apogee; both under the one default name.
    expect(deployments.map((e) => e.source)).toEqual([kernelComponentName(DROGUE), kernelComponentName(MAIN)]);
    const landed = result.events.find((e) => e.type === 'GROUND_HIT')!.time;
    const mainRate = Math.abs(seriesAt(result.series, 'velocity', landed)!);
    const drogueRate = Math.abs(seriesAt(result.series, 'velocity', deployments[1]!.time)!);
    // Far enough apart that the one-decimal readout tells them apart.
    expect(Math.abs(mainRate - drogueRate)).toBeGreaterThan(1);

    const s = useWorkspaceStore.getState();
    const [first] = s.sims;
    useWorkspaceStore.setState({
      tree: DUAL_TREE,
      info: { mass: 0.1, cg: 0.2, cp: 0.3, length: 0.37 } as never,
      configs: [
        { id: 'c1', name: 'C6', motors: { m: { spec: { designation: 'C6', masses: [0.024, 0.012] } } } } as never,
      ],
      sims: [{ ...first!, configId: 'c1', result, resultKey: undefined }],
    });
    useWorkspaceStore.setState((st) => ({ sims: st.sims.map((x) => asFlown(st, x)) }));
    useWorkspaceStore.setState({ activeId: selectActive(useWorkspaceStore.getState()).id });

    renderWithProviders(<RecoverySizingReadout node={MAIN} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Descent sizing…' }));
    expect(document.body.textContent).toMatch(/Measured in the last run/);
    const row = screen.getByText('This canopy', { selector: 'span.text-xs' }).parentElement!;
    expect(row.textContent).toContain(mainRate.toFixed(1));
    expect(row.textContent).not.toContain(drogueRate.toFixed(1));
  });
});

const C6_TIMES = [0, 0.1, 0.3, 0.5, 1.0, 1.5, 1.85, 2.0];
const C6_THRUSTS = [0, 12.0, 6.0, 5.1, 4.9, 4.8, 4.5, 0];
const C6_MASSES = [0.024, 0.0231, 0.0215, 0.0202, 0.0174, 0.0147, 0.0133, 0.0132];

const DROGUE = {
  id: 'drogue',
  type: 'parachute',
  diameter: 0.15,
  cd: 0.8,
  drogue: true,
  deployEvent: 'apogee',
} as unknown as ComponentNode;
const MAIN = {
  id: 'main',
  type: 'parachute',
  diameter: 0.6,
  cd: 0.8,
  deployEvent: 'altitude',
  deployAltitude: 30,
} as unknown as ComponentNode;

const DUAL_TREE = {
  name: 'R',
  components: [
    {
      id: 'st',
      type: 'stage',
      name: 'Sustainer',
      children: [
        { id: 'n', type: 'nosecone', shape: 'ogive', length: 0.07, aftRadius: 0.013, thickness: 0.001 },
        {
          id: 'm',
          type: 'bodytube',
          length: 0.3,
          outerRadius: 0.013,
          thickness: 0.0005,
          motorMount: true,
          children: [
            {
              id: 'f',
              type: 'trapezoidfinset',
              finCount: 3,
              rootChord: 0.06,
              tipChord: 0.03,
              sweep: 0.03,
              height: 0.05,
              thickness: 0.003,
            },
            DROGUE,
            MAIN,
          ],
        },
      ],
    },
  ],
} as unknown as RocketTree;

/**
 * The dialog sizes the canopy for the Cd the kernel flies.
 *
 * The dialog reads the node's stored Cd, Auto or not, and that is the kernel's
 * figure for a parachute: `RecoveryDevice.getCD` takes `getComponentCD` on
 * Auto, and `Parachute.getComponentCD` returns the stored `cd`, while a chute
 * with no `cd` flies `Parachute.DEFAULT_CD`. Both are read here from the
 * bridge, not restated, so a kernel that starts to estimate a parachute's Cd
 * fails this test and the dialog then has to read the kernel's figure.
 */
describe('the descent-sizing dialog on a chute whose Cd is on Auto', () => {
  afterEach(() => __setEngineForTests(null));

  it.each([
    ['a stored Cd', { ...CHUTE, cd: 1.5, cdAuto: true }],
    ['no stored Cd', { id: 'chute', type: 'parachute', diameter: 0.4, cdAuto: true }],
  ])('solves the diameters for the Cd the kernel flies (%s)', async (_label, chute) => {
    const node = chute as unknown as ComponentNode;
    const tree = treeWith(node);
    const engine = await loadEngine();
    __setEngineForTests(engine);
    const kernelCd = buildRocketTree(tree).componentInfo('chute').cd!;
    expect(Number.isFinite(kernelCd)).toBe(true);

    const config = {
      id: 'c1',
      name: 'C6',
      motors: { m: { spec: { designation: 'C6', masses: [0.024, 0.012] } } },
    } as never;
    const [first] = useWorkspaceStore.getState().sims;
    useWorkspaceStore.setState({
      tree,
      info: { mass: 0.1, cg: 0.2, cp: 0.3, length: 0.37 } as never,
      configs: [config],
      sims: [{ ...first!, configId: 'c1', result: null, resultKey: undefined }],
    });
    useWorkspaceStore.setState({ activeId: selectActive(useWorkspaceStore.getState()).id });

    const patches: Partial<ComponentNode>[] = [];
    renderWithProviders(<RecoverySizingReadout node={node} onChange={(p) => patches.push(p)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Descent sizing…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use the main diameter' }));

    const mass = descentMass(0.1, motorSpecs(tree, config))!;
    const rho = airDensity(selectActive(useWorkspaceStore.getState()).launch);
    const diameter = (patches[0] as { diameter: number }).diameter;
    expect(diameter).toBeCloseTo(canopyDiameter(mass, MAIN_BAND.target, kernelCd, rho), 9);
    expect(document.body.textContent).toContain(`Cd ${fmtNum(kernelCd, 2)}`);
  });
});
