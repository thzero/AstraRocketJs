import { describe, it, expect } from 'vitest';
// @ts-expect-error - a plain .mjs build script helper, no types
import { uniqueRows } from '../../scripts/lib/partRows.mjs';

/**
 * Desktop's library holds one preset per `.orc` element
 * (`ComponentPresetFactory.create` runs once per element the loader reads), and
 * a saved `.ork` names a preset by its digest, an MD5 over every property the
 * preset holds. Two parachute elements that differ only in what
 * `Parachute.loadFromPreset` applies beyond the canopy (line count, line
 * length, packed size, materials) are two presets with two digests. The row
 * sync-components pushes for a parachute carries the canopy only, and
 * sync-preset-digests fills in the rest from the desktop's loader, so the
 * pushed row is the same for both elements and the key it is kept under has to
 * read the element.
 */
const chute = (fields: Record<string, string>) =>
  `<Parachute>
  <Manufacturer>Example Chutes</Manufacturer>
  <PartNumber>EC-24</PartNumber>
  <Description>24 in. canopy</Description>
  <Material Type="SURFACE">${fields.material ?? 'Ripstop nylon'}</Material>
  <Diameter Unit="in">24</Diameter>
  <DragCoefficient>1.5</DragCoefficient>
  <LineCount>${fields.lineCount ?? '6'}</LineCount>
  <LineLength Unit="in">${fields.lineLength ?? '30'}</LineLength>
  <LineMaterial Type="LINE">${fields.lineMaterial ?? 'Nylon line'}</LineMaterial>
  ${fields.packedLength ? `<PackedLength Unit="in">${fields.packedLength}</PackedLength>` : ''}
</Parachute>`;

/** The row the parachute pass pushes: the canopy only. */
const canopy = () => ({
  type: 'parachute',
  mfr: 'Example Chutes',
  partNo: 'EC-24',
  desc: '24 in. canopy',
  diameter: 24 * 0.0254,
  cd: 1.5,
});

const rowsFor = (blocks: string[]) => {
  const { rows, push } = uniqueRows() as {
    rows: unknown[];
    push: (row: unknown, block?: string) => void;
  };
  for (const block of blocks) push(canopy(), block);
  return rows;
};

describe('the rows the parts catalog keeps', () => {
  it('keeps two parachute elements that differ only in line count as two rows', () => {
    expect(rowsFor([chute({ lineCount: '6' }), chute({ lineCount: '8' })])).toHaveLength(2);
  });

  it('keeps a parachute element repeated in every field once', () => {
    expect(rowsFor([chute({}), chute({})])).toHaveLength(1);
  });

  it.each([
    ['line length', { lineLength: '36' }],
    ['packed length', { packedLength: '4' }],
    ['canopy material', { material: 'Mylar' }],
    ['line material', { lineMaterial: 'Kevlar' }],
  ])('keeps a parachute element that differs only in %s as its own row', (_what, fields) => {
    expect(rowsFor([chute({}), chute(fields)])).toHaveLength(2);
  });

  it('keeps every other type by the fields its row carries', () => {
    const { rows, push } = uniqueRows() as { rows: unknown[]; push: (row: unknown) => void };
    const tube = (length: number) => ({
      type: 'bodytube',
      mfr: 'Example',
      partNo: 'BT-50',
      outerDiameter: 0.0248,
      length,
    });
    push(tube(0.3));
    push(tube(0.3));
    push(tube(0.45));
    expect(rows).toHaveLength(2);
  });
});
