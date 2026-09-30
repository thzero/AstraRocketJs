// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportOrk, importOrk } from '../../../../src/services/files/orkFile';
import type { ComponentNode, RocketTree } from '../../../../src/engine/openRocketEngine';

const node = (o: object) => o as unknown as ComponentNode;

/**
 * The imported chute's node id.
 *
 * `.ork` carries no component ids, so the importer mints them: a configuration's
 * deployment map is keyed by the ids from the SAME parse, which is what makes
 * re-exporting an imported design write the blocks back against the right parts.
 */
const chuteId = (tree: RocketTree): string => {
  const stack = [...tree.components];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === 'parachute') return n.id as string;
    if (n.children) stack.push(...n.children);
  }
  throw new Error('no parachute in the imported tree');
};

/**
 * A configuration's recovery and staging settings have to survive the file.
 *
 * The design's own values are the bare tags on the device; a configuration that
 * opens the chute somewhere else writes a `<deploymentconfiguration>` block of
 * its own. Lose either half and saving a design becomes the app deciding that
 * every setup recovers the way the one that was open does.
 */
const tree = {
  name: 'Dual',
  components: [
    node({
      type: 'stage',
      id: 's',
      children: [
        node({ type: 'nosecone', id: 'nose', length: 0.1, aftRadius: 0.012, thickness: 0.001 }),
        node({
          type: 'bodytube',
          id: 'body',
          length: 0.4,
          outerRadius: 0.012,
          thickness: 0.001,
          children: [
            node({
              type: 'parachute',
              id: 'main',
              diameter: 0.5,
              cd: 0.8,
              deployEvent: 'apogee',
              deployAltitude: 200,
              deployDelay: 0,
            }),
          ],
        }),
      ],
    }),
  ],
} as unknown as RocketTree;

const configs = [
  { id: 'cfg-a', name: 'As designed', motors: {} },
  {
    id: 'cfg-b',
    name: 'Low and late',
    motors: {},
    deployments: { main: { deployEvent: 'altitude', deployAltitude: 150, deployDelay: 2 } },
  },
];

describe('per-configuration separation through a .ork', () => {
  /** Two stages, so there is a booster with a separation trigger to override. */
  const staged = {
    name: 'Two stage',
    components: [
      node({
        type: 'stage',
        id: 'sustainer',
        children: [node({ type: 'bodytube', id: 'upper', length: 0.3, outerRadius: 0.012, thickness: 0.001 })],
      }),
      node({
        type: 'stage',
        id: 'booster',
        separationEvent: 'ejection',
        separationDelay: 0,
        children: [node({ type: 'bodytube', id: 'lower', length: 0.3, outerRadius: 0.012, thickness: 0.001 })],
      }),
    ],
  } as unknown as RocketTree;

  const boosterId = (tree: RocketTree): string => tree.components[1]!.id as string;

  const staging = [
    { id: 'cfg-a', name: 'As designed', motors: {} },
    {
      id: 'cfg-b',
      name: 'Late drop',
      motors: {},
      separations: { booster: { separationEvent: 'burnout', separationDelay: 3 } },
    },
  ];

  it('writes each configuration its own block, and reads them back apart', () => {
    const xml = exportOrk({ name: 'Two stage', tree: staged, configs: staging, activeConfigId: 'cfg-a' });
    const res = importOrk(xml);
    const booster = boosterId(res.tree);
    const a = res.configs.find((c) => c.id === 'cfg-a')!;
    const b = res.configs.find((c) => c.id === 'cfg-b')!;
    expect(a.separations[booster]).toMatchObject({ separationEvent: 'ejection', separationDelay: 0 });
    expect(b.separations[booster]).toMatchObject({ separationEvent: 'burnout', separationDelay: 3 });
  });

  it('writes each configuration"s grounded stages, and reads them back', () => {
    const grounding = [
      { id: 'cfg-a', name: 'Both stages', motors: {} },
      { id: 'cfg-b', name: 'Sustainer only', motors: {}, grounded: ['booster'] },
    ];
    const xml = exportOrk({ name: 'Two stage', tree: staged, configs: grounding, activeConfigId: 'cfg-a' });
    // The flags are per stage NUMBER in the file: 0 is the sustainer, 1 the booster.
    expect(xml).toMatch(/<motorconfiguration configid="cfg-b"[\s\S]*?<stage number="1" active="false"\/>/);
    const res = importOrk(xml);
    const booster = boosterId(res.tree);
    expect(res.configs.find((c) => c.id === 'cfg-a')!.grounded).toEqual([]);
    expect(res.configs.find((c) => c.id === 'cfg-b')!.grounded).toEqual([booster]);
  });

  it('survives a second trip, so saving one setup keeps the other"s staging', () => {
    const first = importOrk(exportOrk({ name: 'Two stage', tree: staged, configs: staging, activeConfigId: 'cfg-a' }));
    const again = exportOrk({ name: 'Two stage', tree: first.tree, configs: first.configs, activeConfigId: 'cfg-a' });
    const second = importOrk(again);
    const b = second.configs.find((c) => c.id === 'cfg-b')!;
    expect(b.separations[boosterId(second.tree)]).toMatchObject({ separationEvent: 'burnout', separationDelay: 3 });
  });
});

describe('per-configuration deployment through a .ork', () => {
  const xml = exportOrk({ name: 'Dual', tree, configs, activeConfigId: 'cfg-a' });

  it('writes the design values as the bare tags', () => {
    expect(xml).toContain('<deployevent>apogee</deployevent>');
  });

  it('writes the overriding configuration"s own block', () => {
    expect(xml).toContain('<deploymentconfiguration configid="cfg-b">');
    expect(xml).toMatch(/<deploymentconfiguration configid="cfg-b">[\s\S]*?<deployaltitude>150<\/deployaltitude>/);
  });

  it('reads both back, each against its own configuration', () => {
    const res = importOrk(xml);
    const chute = chuteId(res.tree);
    const a = res.configs.find((c) => c.id === 'cfg-a')!;
    const b = res.configs.find((c) => c.id === 'cfg-b')!;
    // The one that overrides nothing comes back with the design's own values,
    // which is what it flies.
    expect(a.deployments[chute]).toMatchObject({ deployEvent: 'apogee', deployAltitude: 200 });
    expect(b.deployments[chute]).toMatchObject({ deployEvent: 'altitude', deployAltitude: 150, deployDelay: 2 });
  });

  it('survives a second trip, so opening one setup and saving keeps the other', () => {
    // Re-exported the way the app does it: the tree that came out of the import,
    // whose node ids are the ones the configurations are keyed by.
    const first = importOrk(xml);
    const again = exportOrk({ name: 'Dual', tree: first.tree, configs: first.configs, activeConfigId: 'cfg-a' });
    const second = importOrk(again);
    const b = second.configs.find((c) => c.id === 'cfg-b')!;
    expect(b.deployments[chuteId(second.tree)]).toMatchObject({
      deployEvent: 'altitude',
      deployAltitude: 150,
      deployDelay: 2,
    });
  });

  it('writes a lone configuration"s override too, where there is no second row to compare against', () => {
    const solo = exportOrk({ name: 'Dual', tree, configs: [configs[1]!], activeConfigId: 'cfg-b' });
    expect(solo).toContain('<deploymentconfiguration configid="cfg-b">');
    const back = importOrk(solo);
    expect(back.configs[0]!.deployments[chuteId(back.tree)]).toMatchObject({ deployAltitude: 150 });
  });
});
