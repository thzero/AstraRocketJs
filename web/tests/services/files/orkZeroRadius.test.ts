// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importOrk } from '../../../src/services/files/orkFile';
import { walkNodes } from '../../../src/tree/treeWalk';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

/**
 * A radius a `.ork` states as 0 is 0, not automatic.
 *
 * Desktop's DocumentConfig reads each of these through a DoubleSetter that
 * takes `auto` as the automatic flag and any number as the value
 * (`BodyTube:radius` calls `setOuterRadius(0.0)`), so a stated 0 stays 0. The
 * bundled pods example carries its horizontal stabilizer on a phantom body tube
 * of radius 0; read as automatic, the tube would take the pod's radius and move
 * the stabilizer pod out by it. `npm run audit` compares desktop's read of that
 * example with the app's import.
 */

const doc = (parts: string) => `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.10" creator="test"><rocket><name>R</name><subcomponents>
<stage><name>S</name><subcomponents>${parts}</subcomponents></stage>
</subcomponents></rocket></openrocket>`;

const first = (xml: string, type: string): ComponentNode =>
  [...walkNodes(importOrk(doc(xml)).tree.components)].find((n) => n.type === type)!;

const tube = (radius: string, inside = '') =>
  `<bodytube><name>B</name><length>0.3</length><radius>${radius}</radius><subcomponents>${inside}</subcomponents></bodytube>`;

describe('a radius stated as 0', () => {
  it.each([
    ['a body tube', () => first(tube('0.0'), 'bodytube'), 'outerRadius'],
    [
      'a nose cone aft end',
      () =>
        first(
          '<nosecone><name>N</name><length>0.1</length><aftradius>0</aftradius></nosecone>' + tube('0.012'),
          'nosecone',
        ),
      'aftRadius',
    ],
    [
      'a transition fore end',
      () =>
        first(
          tube('0.012') +
            '<transition><name>T</name><length>0.05</length><foreradius>0.0</foreradius><aftradius>0.012</aftradius></transition>',
          'transition',
        ),
      'foreRadius',
    ],
    [
      'an inner tube',
      () =>
        first(
          tube(
            '0.012',
            '<innertube><name>I</name><length>0.07</length><outerradius>0</outerradius><thickness>0</thickness></innertube>',
          ),
          'innertube',
        ),
      'outerRadius',
    ],
  ])('is 0 on %s, not automatic', (_label, read, key) => {
    const n = read();
    expect(n[key]).toBe(0);
    expect(n[`${key}Auto`]).not.toBe(true);
  });

  it('leaves `auto` automatic', () => {
    expect(first(tube('auto'), 'bodytube')['outerRadiusAuto']).toBe(true);
  });

  it("keeps the bundled pods example's phantom body tube at the axis", () => {
    const bytes = readFileSync(resolve(__dirname, '../../../public/examples/pods-airframes-and-winglets.ork'));
    const tree = importOrk(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).tree;
    const phantom = [...walkNodes(tree.components)].find((n) => n.name === '(phantom body)')!;
    expect(phantom['outerRadius']).toBe(0);
    expect(phantom['outerRadiusAuto']).not.toBe(true);
  });
});
