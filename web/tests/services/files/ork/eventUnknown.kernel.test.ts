// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../../src/engine/openRocketEngine';
import { importOrk } from '../../../../src/services/files/orkFile';
import { walkNodes } from '../../../../src/tree/treeWalk';
import { loadEngine } from '../../../testing/kernelGeometry';
import { noteTexts } from '../../../testing/importNotes';
import { KERNEL_TEST_TIMEOUT_MS } from '../../../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/* eslint-disable @typescript-eslint/no-explicit-any -- the TeaVM bundle is untyped */
let engine: any;
beforeAll(async () => {
  engine = await loadEngine();
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * A deploy or separation event the kernel has no constant for is dropped with
 * a note, and the file opens.
 *
 * The bridge throws on an unknown event name (`ComponentFactory.deployEventOf`,
 * `OpenRocketEngine.separationEventOf`), which would refuse the whole file.
 * Desktop reads the same file with a warning and keeps the default event
 * (`DocumentConfig.findEnum` returns null, the handler keeps its default). The
 * expected event is the kernel's own, read back from the same design with the
 * tag left out, never a constant of the app's.
 */

const ork = (opts: { deploy: string; separation: string; configs?: boolean; blocks?: boolean }): string =>
  `<?xml version="1.0"?><openrocket version="1.8"><rocket><name>T</name>` +
  (opts.configs ? `<motorconfiguration configid="c1" default="true"/>` : '') +
  `<subcomponents>` +
  `<stage><name>Sustainer</name><subcomponents>` +
  `<nosecone><name>Nose</name><shape>ogive</shape><length>0.1</length><aftradius>0.025</aftradius></nosecone>` +
  `<bodytube><name>Body</name><length>0.3</length><radius>0.025</radius><subcomponents>` +
  `<parachute><name>Chute</name><diameter>0.3</diameter>${opts.deploy}` +
  (opts.blocks
    ? `<deploymentconfiguration configid="c1"><deployevent>bogus</deployevent></deploymentconfiguration>`
    : '') +
  `</parachute>` +
  `</subcomponents></bodytube></subcomponents></stage>` +
  `<stage><name>Booster</name>${opts.separation}` +
  (opts.blocks
    ? `<separationconfiguration configid="c1"><separationevent>bogus</separationevent></separationconfiguration>`
    : '') +
  `<subcomponents>` +
  `<bodytube><name>Booster tube</name><length>0.2</length><radius>0.025</radius></bodytube>` +
  `</subcomponents></stage>` +
  `</subcomponents></rocket></openrocket>`;

const partOf = (tree: RocketTree, type: string, name: string): ComponentNode =>
  [...walkNodes(tree.components)].find((n) => n.type === type && n.name === name)!;

/** The event the kernel flies for the part, read back through the bridge. */
function kernelEvent(tree: RocketTree, id: string, key: 'deployEvent' | 'separationEvent'): string {
  engine.reset();
  const handle = engine.buildRocket(JSON.stringify(tree));
  const fields = JSON.parse(engine.getComponentFields(handle, id)) as Record<string, unknown>;
  if (typeof fields.error === 'string') throw new Error(fields.error);
  return String(fields[key]).toLowerCase().replace(/_/g, '');
}

/** The events the kernel flies for the same design with no event tags at all. */
function kernelDefaults(): { deploy: string; separation: string } {
  const control = importOrk(ork({ deploy: '', separation: '' })).tree;
  return {
    deploy: kernelEvent(control, partOf(control, 'parachute', 'Chute').id!, 'deployEvent'),
    separation: kernelEvent(control, partOf(control, 'stage', 'Booster').id!, 'separationEvent'),
  };
}

describe('an event name the kernel does not have', () => {
  it('on the design is dropped, noted, and flies the default event', () => {
    const res = importOrk(
      ork({ deploy: '<deployevent>bogus</deployevent>', separation: '<separationevent>bogus</separationevent>' }),
    );
    const chute = partOf(res.tree, 'parachute', 'Chute');
    const booster = partOf(res.tree, 'stage', 'Booster');
    expect(chute['deployEvent']).toBeUndefined();
    expect(booster['separationEvent']).toBeUndefined();
    const notes = noteTexts(res.notes);
    expect(notes).toContain(
      'Chute: the file names a deployment event "bogus" this app does not have, so the default event is used.',
    );
    expect(notes).toContain(
      'Booster: the file names a separation event "bogus" this app does not have, so the default event is used.',
    );
    const defaults = kernelDefaults();
    expect(kernelEvent(res.tree, chute.id!, 'deployEvent')).toBe(defaults.deploy);
    expect(kernelEvent(res.tree, booster.id!, 'separationEvent')).toBe(defaults.separation);
  });

  it("in a configuration's override block is dropped and noted, and the design's event stands", () => {
    const res = importOrk(
      ork({
        deploy: '<deployevent>apogee</deployevent>',
        separation: '<separationevent>burnout</separationevent>',
        configs: true,
        blocks: true,
      }),
    );
    const chute = partOf(res.tree, 'parachute', 'Chute');
    const booster = partOf(res.tree, 'stage', 'Booster');
    expect(chute['deployEvent']).toBe('apogee');
    expect(booster['separationEvent']).toBe('burnout');
    // The override is the design's value with the block's fields over it, and
    // the block's one field was dropped: the override says what the design says.
    const config = res.configs[0]!;
    expect(config.deployments[chute.id!]?.deployEvent).toBe('apogee');
    expect(config.separations[booster.id!]?.separationEvent).toBe('burnout');
    const notes = noteTexts(res.notes);
    expect(notes.filter((n) => n.includes('deployment event "bogus"'))).toHaveLength(1);
    expect(notes.filter((n) => n.includes('separation event "bogus"'))).toHaveLength(1);
  });

  it('matches the names desktop writes, with or without underscores', () => {
    const res = importOrk(
      ork({
        deploy: '<deployevent>lowerstageseparation</deployevent>',
        separation: '<separationevent>UPPER_IGNITION</separationevent>',
      }),
    );
    expect(partOf(res.tree, 'parachute', 'Chute')['deployEvent']).toBe('lower_stage_separation');
    expect(partOf(res.tree, 'stage', 'Booster')['separationEvent']).toBe('upperignition');
    expect(noteTexts(res.notes).some((n) => n.includes('event'))).toBe(false);
  });
});
