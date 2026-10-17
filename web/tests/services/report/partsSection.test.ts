import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import i18n from '../../../src/i18n';
import type { ReportModel } from '../../../src/services/report/reportModel';
import type { ReportOptions } from '../../../src/services/report/options';
import { createPdfPage, type T } from '../../../src/services/report/pdfPage';
import { writePartsSection } from '../../../src/services/report/partsSection';
import { METRIC_UNITS, UNITS, type UnitSelection } from '../../../src/prefs/units';

type Rows = ReportModel['partsByStage'][number]['rows'];

/** The parts section's text for some rows, drawn into a real jsPDF document. */
function drawnRows(rows: Rows, units: UnitSelection): string {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const runs: string[] = [];
  const text = doc.text.bind(doc);
  doc.text = ((...a: Parameters<typeof text>) => {
    const s = a[0];
    runs.push(...(Array.isArray(s) ? s : [s]).map(String));
    return text(...a);
  }) as typeof doc.text;
  const t = i18n.getFixedT('en') as unknown as T;
  const page = createPdfPage(doc, t, {} as ReportOptions, units);
  writePartsSection(page, [{ stage: 'Sustainer', rows }]);
  return runs.join(' ').replace(/\s+/g, ' ');
}

/** The parts section's text for one body tube. */
const drawnText = (length: string, thickness: number): string =>
  drawnRows(
    [{ depth: 0, type: 'bodytube', name: 'Body', length: 0.3, outerR: 0.0124, innerR: 0.01188, thickness, mass: 0.01 }],
    { ...METRIC_UNITS, length },
  );

describe('the parts section', () => {
  // A BT-50's wall is 0.53 mm, 0.021 in: two fixed decimals print it as 0.02 in.
  it('prints a wall to the ladder in the unit shown', () => {
    expect(drawnText('in', 0.000533)).toContain('0.021 in');
    expect(drawnText('mm', 0.000533)).toContain('0.533 mm');
  });

  // RecoveryDevice.getMaterial is a surface material and ShockCord.getMaterial a
  // line material, so their densities print per area and per length.
  it('prints a soft part density in the unit of its kind', () => {
    const out = drawnRows(
      [
        {
          depth: 0,
          type: 'parachute',
          name: 'P',
          material: 'Silk',
          density: 0.021,
          densityKind: 'surfaceDensity',
          length: 0.04,
          mass: 0.01,
        },
        {
          depth: 0,
          type: 'shockcord',
          name: 'C',
          material: 'Tubular nylon',
          density: 0.013,
          densityKind: 'lineDensity',
          length: 0.04,
          mass: 0.01,
        },
      ],
      METRIC_UNITS,
    );
    expect(out).toContain('Silk (21 g/m²)');
    expect(out).toContain('Tubular nylon (13 g/m)');
  });

  // The lightest line in the material catalog: a fixed count of decimals in
  // kilograms per meter rounds it to zero.
  it('prints a thread density to significant figures in every line unit', () => {
    const kevlar = (
      JSON.parse(readFileSync(join(__dirname, '../../../public/data/materials.generated.json'), 'utf8')) as {
        name: string;
        type: string;
        density: number;
      }[]
    ).find((m) => m.type === 'line' && m.name.startsWith('Kevlar thread 138'))!;
    for (const symbol of ['kg/m', 'g/m', 'lb/ft']) {
      const out = drawnRows(
        [
          {
            depth: 0,
            type: 'shockcord',
            name: 'C',
            material: 'Thread',
            density: kevlar.density,
            densityKind: 'lineDensity',
            length: 0.3,
            mass: 0.0001,
          },
        ],
        { ...METRIC_UNITS, lineDensity: symbol },
      );
      const shown = out.match(/Thread \(([^)]*) (?:kg\/m|g\/m|lb\/ft)\)/)?.[1] ?? '';
      const exact = kevlar.density / UNITS.lineDensity.find((u) => u.symbol === symbol)!.toSI;
      // At least two significant figures: within half a unit of the second one.
      const within =
        Math.abs(Number(shown.replace(/,/g, '')) - exact) <= 0.5 * 10 ** (Math.floor(Math.log10(exact)) - 1);
      expect({ symbol, shown, exact, within }).toEqual({ symbol, shown, exact, within: true });
    }
  });
});
