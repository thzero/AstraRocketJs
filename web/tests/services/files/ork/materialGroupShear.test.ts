// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../../src/engine/openRocketEngine';
import { exportOrk, importOrk } from '../../../../src/services/files/orkFile';
import { walkNodes } from '../../../../src/tree/treeWalk';

/**
 * A part's `<material>` attributes survive the round trip.
 *
 * Upstream's `RocketComponentSaver.materialParam` writes every part's bulk
 * material as `density`, then `shearModulus` when the modulus is set or the
 * material is user-defined, then `group`; desktop's `MaterialSetter` reads all
 * three back and looks the material up by them, with no group when the
 * attribute is missing. So the reader keeps the group and the modulus on every
 * part, not only a rail button, and the writer puts them back in that order.
 */

const ork = (material: string): string =>
  `<?xml version="1.0"?><openrocket version="1.8"><rocket><name>T</name><subcomponents><stage><name>S</name><subcomponents>` +
  `<bodytube><name>Body</name><length>0.3</length><radius>0.012</radius><thickness>0.001</thickness>${material}</bodytube>` +
  `</subcomponents></stage></subcomponents></rocket></openrocket>`;

const bodyOf = (tree: RocketTree): ComponentNode => [...walkNodes(tree.components)].find((n) => n.type === 'bodytube')!;

const materialLine = (xml: string): string => /<material type="bulk"[^>]*>[^<]*<\/material>/.exec(xml)![0];

describe('a body tube material with a group and a shear modulus', () => {
  const res = importOrk(
    ork('<material type="bulk" density="1850" shearModulus="4.2E9" group="Composites">Fiberglass</material>'),
  );
  const body = bodyOf(res.tree);

  it('reads both onto the node', () => {
    expect(body['materialGroup']).toBe('Composites');
    expect(body['shearModulus']).toBe(4.2e9);
    expect(body.density).toBe(1850);
    expect(body['materialName']).toBe('Fiberglass');
  });

  it('writes both back, modulus before group as upstream does', () => {
    expect(materialLine(exportOrk({ name: 'T', tree: res.tree }))).toBe(
      '<material type="bulk" density="1850" shearModulus="4200000000" group="Composites">Fiberglass</material>',
    );
  });
});

describe('a body tube material with neither', () => {
  it('writes neither attribute', () => {
    const res = importOrk(ork('<material type="bulk" density="680">Cardboard</material>'));
    expect(bodyOf(res.tree)['materialGroup']).toBeUndefined();
    expect(bodyOf(res.tree)['shearModulus']).toBeUndefined();
    expect(materialLine(exportOrk({ name: 'T', tree: res.tree }))).toBe(
      '<material type="bulk" density="680">Cardboard</material>',
    );
  });

  it('drops a modulus that is not a number', () => {
    const res = importOrk(ork('<material type="bulk" density="680" shearModulus="soft">Cardboard</material>'));
    expect(bodyOf(res.tree)['shearModulus']).toBeUndefined();
  });
});
