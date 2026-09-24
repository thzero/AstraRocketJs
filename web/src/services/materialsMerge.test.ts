import { describe, it, expect, beforeAll } from 'vitest';
import { DEFAULT_CUSTOM_GROUP, builtinsForType, groupsOf, mergeCustom } from './materials';
import type { Material } from './materialTypes';
import { serveData } from '../testing/serveData';

/**
 * How a custom material joins the list.
 *
 * It used to be `[...custom, ...builtins]` with every custom material filed
 * under a `Custom` group of its own, which had two problems. A custom material
 * named after a built-in appeared TWICE, in two different groups, and which one
 * a design picked up depended on which the lookup found first. And a material
 * that is a variant of Plywood was listed at the top of the picker rather than
 * beside the plywood, because the group said where it came from instead of what
 * it is.
 *
 * Now the provenance is carried by the `custom` flag alone — the picker stars
 * it — and the group says what the material is.
 */

const m = (name: string, group: string, density: number, custom = false): Material => ({
  name,
  type: 'bulk',
  density,
  group,
  ...(custom ? { custom: true } : {}),
});

const BUILTINS = [
  m('Acrylic', 'Plastics', 1190),
  m('Delrin', 'Plastics', 1420),
  m('Balsa', 'Woods', 170),
  m('Plywood (birch)', 'Woods', 630),
  m('Blue tube', 'Composites', 1300),
];

describe('mergeCustom', () => {
  it('leaves the built-ins alone when there are no custom materials', () => {
    expect(mergeCustom(BUILTINS, [])).toEqual(BUILTINS);
  });

  it('replaces a built-in of the same name, in place, keeping its group', () => {
    const merged = mergeCustom(BUILTINS, [m('Blue tube', DEFAULT_CUSTOM_GROUP, 1250, true)]);
    // One entry, not two: it is that material at your density.
    expect(merged.filter((x) => x.name === 'Blue tube')).toHaveLength(1);
    const blue = merged.find((x) => x.name === 'Blue tube')!;
    expect(blue.density).toBe(1250);
    expect(blue.custom).toBe(true);
    // Still in Composites, still where Blue tube was.
    expect(blue.group).toBe('Composites');
    expect(merged.map((x) => x.name)).toEqual(BUILTINS.map((x) => x.name));
  });

  it('puts a new material in the group it was given, after the last member', () => {
    const merged = mergeCustom(BUILTINS, [m('Aircraft ply 1/8', 'Woods', 700, true)]);
    const names = merged.map((x) => x.name);
    expect(names).toEqual(['Acrylic', 'Delrin', 'Balsa', 'Plywood (birch)', 'Aircraft ply 1/8', 'Blue tube']);
    expect(merged.find((x) => x.name === 'Aircraft ply 1/8')!.group).toBe('Woods');
  });

  it('appends a material whose group the built-ins do not have', () => {
    // 'Other' is a real upstream group, but only for line materials; a bulk
    // one lands at the end rather than inventing a slot mid-list.
    const merged = mergeCustom(BUILTINS, [m('Mystery goo', DEFAULT_CUSTOM_GROUP, 900, true)]);
    expect(merged[merged.length - 1]!.name).toBe('Mystery goo');
    expect(merged[merged.length - 1]!.group).toBe(DEFAULT_CUSTOM_GROUP);
  });

  it('re-homes a material saved under the old Custom group', () => {
    // Anything already in a browser from before this change. It must not be
    // stranded in a group nothing else is in.
    const merged = mergeCustom(BUILTINS, [m('Old one', 'Custom', 800, true)]);
    expect(merged.find((x) => x.name === 'Old one')!.group).toBe(DEFAULT_CUSTOM_GROUP);
    expect(merged.some((x) => x.group === 'Custom')).toBe(false);
  });

  it('keeps the custom flag, which is what the picker stars', () => {
    const merged = mergeCustom(BUILTINS, [m('Blue tube', 'Composites', 1250, true), m('New', 'Woods', 700, true)]);
    for (const name of ['Blue tube', 'New']) expect(merged.find((x) => x.name === name)!.custom).toBe(true);
    expect(merged.find((x) => x.name === 'Balsa')!.custom).toBeUndefined();
  });

  it('never lists one name twice', () => {
    const merged = mergeCustom(BUILTINS, [
      m('Blue tube', 'Composites', 1250, true),
      m('Balsa', 'Custom', 180, true),
      m('Brand new', 'Plastics', 1000, true),
    ]);
    const names = merged.map((x) => x.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

/**
 * The add form's group dropdown. It takes the list the picker already has
 * rather than fetching one of its own, so these run it over the real catalog
 * for a type.
 */
describe('groupsOf', () => {
  beforeAll(serveData);

  it('offers the groups that type actually uses, plus somewhere for the rest', async () => {
    const bulk = groupsOf(await builtinsForType('bulk'));
    expect(bulk).toContain('Woods');
    expect(bulk).toContain('Adhesives');
    expect(bulk[bulk.length - 1]).toBe(DEFAULT_CUSTOM_GROUP);
    // Not another type's groups: a bulk material is never Kevlars.
    expect(bulk).not.toContain('Kevlars');
    expect(groupsOf(await builtinsForType('line'))).toContain('Kevlars');
  });

  it('does not offer the retired Custom group', async () => {
    for (const type of ['bulk', 'surface', 'line'] as const) {
      expect(groupsOf(await builtinsForType(type))).not.toContain('Custom');
    }
  });

  it('offers a group the user invented, when one is in the list', () => {
    // The custom materials are in the list it is given, so a material filed
    // under a name of the user's own is offered back to them next time.
    const mine: Material = { name: 'My mix', type: 'bulk', density: 1050, group: 'Putties', custom: true };
    expect(groupsOf([mine])).toEqual(['Putties', DEFAULT_CUSTOM_GROUP]);
  });
});
