import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../src/state/store';
import { C6 } from '../../src/engine/api';
import type { MotorSpec } from '../../src/engine/openRocketEngine';
import { splitCluster } from '../../src/services/design/componentActions';
import { findMounts } from '../../src/services/design/treeEdit';
import { newFlightConfig } from '../../src/services/flight/flightConfigs';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';

/**
 * A copied part takes its per-configuration settings with it, as desktop's
 * copy() carries a part's FlightConfigurableParameterSets: a split cluster or a
 * duplicated mount flies loaded, the way the original did.
 */

const st = () => useWorkspaceStore.getState();

const D12: MotorSpec = { ...C6, designation: 'D12' };

const design = (): RocketTree =>
  ({
    name: 'R',
    components: [
      {
        type: 'stage',
        id: 'st',
        name: 'S',
        children: [
          { type: 'nosecone', id: 'n', length: 0.1, aftRadius: 0.03, thickness: 0.002 },
          {
            type: 'bodytube',
            id: 'b',
            length: 0.4,
            outerRadius: 0.03,
            thickness: 0.001,
            children: [
              {
                type: 'innertube',
                id: 'mt',
                length: 0.1,
                outerRadius: 0.01,
                thickness: 0.0005,
                motorMount: true,
                cluster: '4-ring',
                position: { method: 'bottom', offset: 0 },
              },
            ],
          },
        ],
      },
    ],
  }) as unknown as RocketTree;

/** Every mount id with the motor designation it carries in the active configuration. */
const loaded = (): Record<string, string | undefined> => {
  const config = st().configs[0]!;
  return Object.fromEntries(
    findMounts(st().tree).map((m: ComponentNode) => [
      m.id,
      config.motors[m.id!]
        ? `${config.motors[m.id!]!.spec.designation}+${config.motors[m.id!]!.ignitionDelay ?? 0}`
        : undefined,
    ]),
  );
};

describe('a copied mount keeps its motor', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      tree: design(),
      // Not C6: a mount with no entry is seeded with C6, which would hide a lost one.
      configs: [newFlightConfig({ mt: { spec: D12, ignitionDelay: 1.5 } })],
      selectedId: null,
    });
  });

  it('on every tube of a split cluster', () => {
    st().applyTreeAction((tree, origins) => splitCluster(tree, 'mt', 'Mount', origins));
    const mounts = loaded();
    expect(Object.keys(mounts)).toHaveLength(4);
    expect(Object.values(mounts)).toEqual(['D12+1.5', 'D12+1.5', 'D12+1.5', 'D12+1.5']);
  });

  it('on a duplicate', () => {
    useWorkspaceStore.setState({ selectedId: 'mt' });
    st().duplicateSelected();
    const mounts = loaded();
    expect(Object.keys(mounts)).toHaveLength(2);
    expect(Object.values(mounts)).toEqual(['D12+1.5', 'D12+1.5']);
  });
});
