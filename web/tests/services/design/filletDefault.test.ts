import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_FILLET_MATERIAL, withFilletDefault } from '../../../src/services/design/filletDefault';
import type { ComponentNode } from '../../../src/engine/openRocketEngine';

/**
 * A fillet added in the app starts as epoxy paste, not desktop's default
 * Cardboard. A fillet from a file, or one that already has a material, keeps
 * what it has.
 */
const fin = (extra: Record<string, unknown> = {}) =>
  ({ id: 'f', type: 'trapezoidfinset', ...extra }) as unknown as ComponentNode;

describe('withFilletDefault', () => {
  it('gives a new fillet the epoxy', () => {
    expect(withFilletDefault(fin(), { filletRadius: 0.005 })).toEqual({
      filletRadius: 0.005,
      filletMaterialName: DEFAULT_FILLET_MATERIAL.name,
      filletDensity: DEFAULT_FILLET_MATERIAL.density,
      filletMaterialGroup: DEFAULT_FILLET_MATERIAL.group,
    });
    expect(withFilletDefault(fin({ filletRadius: 0 }), { filletRadius: 0.005 }).filletDensity).toBe(1500);
  });

  it('leaves a fillet that is only being resized', () => {
    expect(withFilletDefault(fin({ filletRadius: 0.003 }), { filletRadius: 0.005 })).toEqual({ filletRadius: 0.005 });
  });

  it('keeps a material the part already has', () => {
    const plywood = fin({ filletDensity: 630, filletMaterialName: 'Plywood (birch)' });
    expect(withFilletDefault(plywood, { filletRadius: 0.005 })).toEqual({ filletRadius: 0.005 });
  });

  it('keeps a material the same edit sets', () => {
    expect(withFilletDefault(fin(), { filletRadius: 0.005, filletDensity: 1200 })).toEqual({
      filletRadius: 0.005,
      filletDensity: 1200,
    });
  });

  it('does nothing for an edit that removes the fillet or is about something else', () => {
    expect(withFilletDefault(fin(), { filletRadius: 0 })).toEqual({ filletRadius: 0 });
    expect(withFilletDefault(fin(), { name: 'Fins' })).toEqual({ name: 'Fins' });
  });

  it('names the material catalog entry exactly', () => {
    const catalog = JSON.parse(
      readFileSync(resolve(__dirname, '../../../public/data/materials.generated.json'), 'utf8'),
    ) as { name: string; density: number; group: string; type: string }[];
    const entry = catalog.find((m) => m.name === DEFAULT_FILLET_MATERIAL.name);
    expect(entry).toMatchObject({
      density: DEFAULT_FILLET_MATERIAL.density,
      group: DEFAULT_FILLET_MATERIAL.group,
      type: 'bulk',
    });
  });
});
