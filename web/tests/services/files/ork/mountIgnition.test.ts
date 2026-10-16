// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { exportOrk, importOrk } from '../../../../src/services/files/orkFile';
import type { ComponentNode, RocketTree } from '../../../../src/engine/openRocketEngine';

/**
 * A mount's own ignition survives a round trip.
 *
 * Desktop keeps it on the mount, apart from any configuration's motor:
 * MotorMountHandler reads the bare `<ignitionevent>`/`<ignitiondelay>` of
 * `<motormount>` into `getDefaultMotorConfig()`, and RocketComponentSaver
 * writes that object back there. A configuration's motor writes its own in an
 * `<ignitionconfiguration>` block. So the bare tags are the mount's, not the
 * default configuration's motor's, and an empty mount still carries them.
 */

const ORK = `<?xml version="1.0"?>
<openrocket version="1.10">
  <rocket>
    <name>Mounts</name>
    <motorconfiguration configid="cfg-1" default="true"/>
    <motorconfiguration configid="cfg-2"/>
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <subcomponents>
          <bodytube>
            <name>Body</name><length>0.3</length><radius>0.02</radius>
            <subcomponents>
              <innertube>
                <name>Loaded</name><length>0.07</length><outerradius>0.0095</outerradius>
                <motormount>
                  <ignitionevent>burnout</ignitionevent>
                  <ignitiondelay>2.0</ignitiondelay>
                  <overhang>0</overhang>
                  <motor configid="cfg-1"><designation>C6</designation><diameter>0.018</diameter><length>0.07</length><delay>3</delay></motor>
                  <motor configid="cfg-2"><designation>C6</designation><diameter>0.018</diameter><length>0.07</length><delay>3</delay></motor>
                  <ignitionconfiguration configid="cfg-2">
                    <ignitionevent>launch</ignitionevent>
                    <ignitiondelay>0.0</ignitiondelay>
                  </ignitionconfiguration>
                </motormount>
              </innertube>
              <innertube>
                <name>Empty</name><length>0.07</length><outerradius>0.0095</outerradius>
                <motormount>
                  <ignitionevent>never</ignitionevent>
                  <ignitiondelay>0.0</ignitiondelay>
                  <overhang>0</overhang>
                </motormount>
              </innertube>
              <innertube>
                <name>Unknown</name><length>0.07</length><outerradius>0.0095</outerradius>
                <motormount>
                  <ignitionevent>bogus</ignitionevent>
                  <ignitiondelay>0.0</ignitiondelay>
                  <overhang>0</overhang>
                </motormount>
              </innertube>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>`;

function walk(nodes: ComponentNode[]): ComponentNode[] {
  return nodes.flatMap((n) => [n, ...walk((n.children as ComponentNode[] | undefined) ?? [])]);
}
const byName = (tree: RocketTree, name: string): ComponentNode => walk(tree.components).find((n) => n.name === name)!;

/** The bare tags and every configuration block of one mount in written XML. */
function mountXml(xml: string, name: string) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const tube = Array.from(doc.querySelectorAll('innertube')).find(
    (el) => el.querySelector(':scope > name')?.textContent === name,
  )!;
  const mount = tube.querySelector(':scope > motormount')!;
  const tag = (el: Element, t: string) => el.querySelector(`:scope > ${t}`)?.textContent;
  return {
    event: tag(mount, 'ignitionevent'),
    delay: Number(tag(mount, 'ignitiondelay')),
    blocks: Array.from(mount.querySelectorAll(':scope > ignitionconfiguration')).map((b) => ({
      id: b.getAttribute('configid'),
      event: tag(b, 'ignitionevent'),
      delay: Number(tag(b, 'ignitiondelay')),
    })),
  };
}

describe('a mount’s own ignition', () => {
  const res = importOrk(ORK);
  const loaded = byName(res.tree, 'Loaded');
  const empty = byName(res.tree, 'Empty');

  it('reads the bare tags onto the mount, with a motor in it or not', () => {
    expect(loaded['ignitionEvent']).toBe('burnout');
    expect(loaded['ignitionDelay']).toBe(2);
    expect(empty['ignitionEvent']).toBe('never');
    expect(empty['ignitionDelay']).toBeUndefined();
  });

  it('drops an event desktop does not know, as MotorMountHandler does', () => {
    expect(byName(res.tree, 'Unknown')['ignitionEvent']).toBeUndefined();
  });

  it('still gives a motor with no block of its own the bare ignition', () => {
    const [cfg1, cfg2] = res.configs;
    expect(cfg1!.motors[loaded.id as string]).toMatchObject({ ignitionEvent: 'burnout', ignitionDelay: 2 });
    expect(cfg2!.motors[loaded.id as string]).toMatchObject({ ignitionEvent: 'launch', ignitionDelay: 0 });
  });

  it('writes the mount’s own bare and each motor’s in its block, and reads both back', () => {
    const motor = { designation: 'C6', manufacturer: 'Estes', diameter: 0.018, length: 0.07, delay: 3 };
    const xml = exportOrk({
      name: 'Mounts',
      tree: res.tree,
      configs: [
        {
          id: 'cfg-1',
          name: null,
          motors: { [loaded.id as string]: { ...motor, ignitionEvent: 'launch', ignitionDelay: 1 } },
        },
      ],
    });
    // Not the default configuration's motor's launch + 1 s.
    expect(mountXml(xml, 'Loaded')).toEqual({
      event: 'burnout',
      delay: 2,
      blocks: [{ id: 'cfg-1', event: 'launch', delay: 1 }],
    });
    expect(mountXml(xml, 'Empty')).toEqual({ event: 'never', delay: 0, blocks: [] });

    const back = importOrk(xml);
    const loadedBack = byName(back.tree, 'Loaded');
    expect(loadedBack).toMatchObject({ ignitionEvent: 'burnout', ignitionDelay: 2 });
    expect(byName(back.tree, 'Empty')['ignitionEvent']).toBe('never');
    expect(back.configs[0]!.motors[loadedBack.id as string]).toMatchObject({
      ignitionEvent: 'launch',
      ignitionDelay: 1,
    });
  });
});
