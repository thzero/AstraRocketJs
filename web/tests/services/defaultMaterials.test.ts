// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { defaultMaterialKey, defaultMaterialPatch } from '../../src/services/materials';
import { addPart } from '../../src/services/treeEdit';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../../src/services/settings';
import type { ComponentNode, RocketTree } from '../../src/engine/openRocketEngine';

/**
 * Settings ▸ Materials: what a NEWLY ADDED part is made of.
 *
 * The preference is spent at CREATION — the part carries the material outright,
 * so it shows in the panel and is written to the `.ork`. Desktop OpenRocket
 * keeps the part unset and applies its equivalent preference when it computes
 * mass, which means the same file weighs one thing on the machine that made it
 * and another on the machine it was sent to. That is the property this design
 * is chosen to avoid, and the round-trip test in `ork/materialRoundTrip.test.ts`
 * is what makes the choice worth anything.
 */

const PLY = { name: 'Plywood (birch)', density: 630 };
const KEVLAR = { name: 'Kevlar 12-strand (3.2 mm, 1/8 in)', density: 0.00967306 };

describe('defaultMaterialPatch', () => {
  it('is empty when nothing is set', () => {
    expect(defaultMaterialPatch('bodytube', {})).toEqual({});
  });

  it('maps a bulk default onto the keys a part carries its material in', () => {
    const patch = defaultMaterialPatch('trapezoidfinset', { 'trapezoidfinset:bulk': PLY });
    expect(patch).toEqual({ materialName: 'Plywood (birch)', density: 630 });
  });

  it('maps surface and line onto their own keys, on one part', () => {
    // A parachute has a canopy AND shroud lines, in different units.
    const patch = defaultMaterialPatch('parachute', {
      'parachute:surface': { name: 'Silk', density: 0.06 },
      'parachute:line': KEVLAR,
    });
    expect(patch).toEqual({
      surfaceMaterialName: 'Silk',
      surfaceDensity: 0.06,
      lineMaterialName: KEVLAR.name,
      lineDensity: KEVLAR.density,
    });
  });

  it('takes only the entry for THIS part type', () => {
    const patch = defaultMaterialPatch('bodytube', {
      'trapezoidfinset:bulk': PLY,
      'bodytube:bulk': { name: 'Blue tube', density: 1300 },
    });
    expect(patch).toEqual({ materialName: 'Blue tube', density: 1300 });
  });

  it('builds the key the settings map is keyed by', () => {
    expect(defaultMaterialKey('parachute', 'line')).toBe('parachute:line');
  });
});

describe('a new part is seeded with it', () => {
  const stage = { type: 'stage', id: 's', name: 'S', children: [] } as unknown as ComponentNode;
  const tree = { name: 'T', components: [stage] } as unknown as RocketTree;

  it('carries the material outright, so the panel and the .ork both see it', () => {
    const seed = defaultMaterialPatch('bodytube', { 'bodytube:bulk': { name: 'Blue tube', density: 1300 } });
    const { tree: next, id } = addPart(tree, 'bodytube', null, seed as Partial<ComponentNode>);
    const added = next.components[0]!.children!.find((n) => n.id === id) as unknown as Record<string, unknown>;
    expect(added['materialName']).toBe('Blue tube');
    expect(added['density']).toBe(1300);
  });

  it('leaves the part unset when there is no preference', () => {
    const { tree: next, id } = addPart(tree, 'bodytube', null);
    const added = next.components[0]!.children!.find((n) => n.id === id) as unknown as Record<string, unknown>;
    expect(added['materialName']).toBeUndefined();
    expect(added['density']).toBeUndefined();
  });

  it('does not overwrite the dimensions a part is created with', () => {
    // The seed is merged ONTO the default node, so it must add a material and
    // nothing else: a body tube still comes out the size it always did.
    const bare = addPart(tree, 'bodytube', null);
    const seeded = addPart(tree, 'bodytube', null, {
      materialName: 'Blue tube',
      density: 1300,
    } as Partial<ComponentNode>);
    const pick = (t: RocketTree) => {
      const n = { ...(t.components[0]!.children![0] as unknown as Record<string, unknown>) };
      delete n['id'];
      delete n['materialName'];
      delete n['density'];
      return n;
    };
    expect(pick(seeded.tree)).toEqual(pick(bare.tree));
  });
});

describe('the stored preference', () => {
  beforeEach(() => localStorage.clear());

  it('survives a save and load', () => {
    saveSettings({ ...DEFAULT_SETTINGS, defaultMaterials: { 'trapezoidfinset:bulk': PLY } });
    expect(loadSettings().defaultMaterials).toEqual({ 'trapezoidfinset:bulk': PLY });
  });

  it('drops anything that would reach the kernel as a bad mass', () => {
    // A density out of this map is stamped onto a part and flown, so a string,
    // a NaN, a negative or a malformed key has to be refused on the way in.
    saveSettings({
      ...DEFAULT_SETTINGS,
      defaultMaterials: {
        'bodytube:bulk': PLY,
        'bodytube:bogus': PLY,
        'bodytube:bulk:extra': PLY,
        bad: PLY,
        'nosecone:bulk': { name: 'X', density: -1 },
        'transition:bulk': { name: '', density: 500 },
        'innertube:bulk': { name: 'Y', density: Number.NaN },
        'bulkhead:bulk': { name: 'Z', density: '900' },
      } as unknown as Record<string, { name: string; density: number }>,
    });
    expect(loadSettings().defaultMaterials).toEqual({ 'bodytube:bulk': PLY });
  });
});
