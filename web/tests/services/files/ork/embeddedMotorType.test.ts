// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { ComponentNode, RocketTree } from '../../../../src/engine/openRocketEngine';
import { embeddedMotorFile } from '../../../../src/services/files/ork/embeddedMotors';
import { importOrk } from '../../../../src/services/files/orkFile';
import { orkArchive } from '../../../../src/services/files/saveOrk';
import { parseRse } from '../../../../src/services/motors/rseParser';
import { customMotorToSpec } from '../../../../src/services/motors/thrustcurve';

/**
 * A motor's type survives from the `.rse` it came in on to the `.rse` a save
 * embeds, in the words desktop's `RockSimMotorLoader` reads: `single-use`,
 * `reloadable`, `hybrid`. Written as single-use, a reload reopens in desktop
 * typed as something it is not. With no type known the attribute is left out,
 * since the loader then takes the type from the manufacturer, which a stated
 * value would override.
 */

const rse = (type: string) =>
  `<engine-database><engine-list>` +
  `<engine mfg="Contrail" code="K456" Type="${type}" dia="54." len="500." initWt="2000." propWt="1000."` +
  ` auto-calc-mass="0" auto-calc-cg="0"><data>` +
  `<eng-data t="0." f="0." m="1000." cg="250."/>` +
  `<eng-data t="0.5" f="500." m="700." cg="250."/>` +
  `<eng-data t="2.0" f="400." m="100." cg="250."/>` +
  `<eng-data t="2.5" f="0." m="0." cg="250."/>` +
  `</data></engine></engine-list></engine-database>`;

const tree = {
  components: [
    {
      type: 'stage',
      id: 's',
      children: [
        { type: 'nosecone', id: 'n', shape: 'ogive', length: 0.2, aftRadius: 0.03 } as ComponentNode,
        {
          type: 'bodytube',
          id: 'b',
          length: 0.6,
          outerRadius: 0.03,
          children: [{ type: 'innertube', id: 'mount', length: 0.5, outerRadius: 0.027, motorMount: true }],
        } as ComponentNode,
      ],
    } as ComponentNode,
  ],
} as RocketTree;

/** The `Type` attribute of the one `.rse` in a saved archive, or null when it carries none. */
function savedType(xmlType: string): string | null {
  const [custom] = parseRse(rse(xmlType));
  const spec = customMotorToSpec(custom!, 6);
  const embedded = embeddedMotorFile(spec)!;
  const bytes = orkArchive({
    name: 'M',
    tree,
    configs: [
      {
        id: 'c1',
        name: null,
        motors: {
          mount: {
            designation: spec.designation,
            manufacturer: spec.manufacturer,
            diameter: spec.diameter,
            length: spec.length,
            delay: 6,
            embedded,
            digest: embedded.digest,
          },
        },
      },
    ],
  });
  const members = unzipSync(bytes);
  const text = strFromU8(members[embedded.path]!);
  const attr = /<engine [^>]*?\sType="([^"]*)"/.exec(text);
  // The same text the import reads back, typed the same way.
  const reopened = importOrk(bytes.slice().buffer as ArrayBuffer);
  expect(parseRse(reopened.embeddedMotors![0]!)[0]!.type).toBe(spec.type);
  return attr ? attr[1]! : null;
}

describe('the type of an embedded motor', () => {
  it('is written as reloadable for a reload', () => {
    expect(savedType('reloadable')).toBe('reloadable');
  });

  it('is written as single-use for a single-use motor', () => {
    expect(savedType('single-use')).toBe('single-use');
  });

  it('is written as hybrid for a hybrid', () => {
    expect(savedType('hybrid')).toBe('hybrid');
  });

  it('is left out when the source gave none, so desktop infers it from the manufacturer', () => {
    expect(savedType('unknown')).toBeNull();
  });
});
