// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { migrateWorkspace } from '../../../src/services/storage/workspaceMigrate';
import { catalogDigest, type CatalogMotor } from '../../../src/services/motors/motorDb';
import { buildExportMotorMap, fillMotorDigests } from '../../../src/services/motors/exportMotors';
import { finalizeSamples } from '../../../src/services/motors/curveFinalize';
import type { ComponentNode, MotorSpec } from '../../../src/engine/openRocketEngine';
import type { Workspace } from '../../../src/services/storage/workspaceStore';

const CATALOG = JSON.parse(
  readFileSync(join(__dirname, '../../../public/data/motors.generated.json'), 'utf8'),
) as CatalogMotor[];

vi.mock('../../../src/services/motors/motorDb', async (original) => ({
  ...(await original<typeof import('../../../src/services/motors/motorDb')>()),
  loadCatalog: vi.fn(async () => CATALOG),
}));

/** The placeholder C6 as stored designs can seat it, some with no maker at all. */
const placeholder = (over: Partial<MotorSpec>): MotorSpec => ({
  designation: 'C6',
  diameter: 0.018,
  length: 0.07,
  times: [0, 0.2, 0.4, 2.0, 2.1],
  thrusts: [0, 12, 5, 5, 0],
  masses: [0.0227, 0.0165, 0.0165, 0.013, 0.012],
  cgX: 0.035,
  ejectionDelay: 3,
  ...over,
});

const stored = (spec: MotorSpec) =>
  ({
    version: 2,
    tree: {
      components: [
        {
          type: 'stage',
          id: 's',
          children: [{ type: 'bodytube', id: 'b', outerRadius: 0.0125, length: 0.3, motorMount: true }],
        } as unknown as ComponentNode,
      ],
    },
    sims: [{ id: 'a', name: 'A', configId: 'c1', launch: {}, result: null }],
    configs: [{ id: 'c1', name: null, motors: { b: { spec } } }],
    activeId: 'a',
    loadedMeta: null,
  }) as unknown as Workspace;

/** The catalog rows whose default curve, finalized, is exactly `spec`'s curve. */
const rowsFlying = (spec: MotorSpec) =>
  CATALOG.filter((r) => {
    const curve = r.curves?.[0]?.samples ? finalizeSamples(r.curves[0].samples) : [];
    return (
      curve.length === spec.times.length && curve.every(([t, f], i) => t === spec.times[i] && f === spec.thrusts[i])
    );
  });

describe('a stored design seating the placeholder C6', () => {
  it.each([
    ['no maker', {}],
    ['a maker', { manufacturer: 'Estes' }],
  ])('with %s opens on the maker of the catalog row whose curve it now flies', (_case, over) => {
    const w = migrateWorkspace(stored(placeholder(over)))!;
    const spec = w.configs[0]!.motors['b']!.spec;
    const rows = rowsFlying(spec);
    expect(rows.map((r) => `${r.manufacturer} ${r.designation}`)).toHaveLength(1);
    expect(spec.manufacturer).toBe(rows[0]!.manufacturer);
  });

  it('saves as that catalog row, not as a curve of its own or another maker’s C6', async () => {
    const w = migrateWorkspace(stored(placeholder({})))!;
    const spec = w.configs[0]!.motors['b']!.spec;
    const [row] = rowsFlying(spec);
    const motors = await fillMotorDigests(buildExportMotorMap(w.tree, w.configs[0]!));
    expect(motors['b']!.embedded).toBeUndefined();
    expect(motors['b']!.digest).toBe(catalogDigest(row!, spec.ejectionDelay));
  });
});
