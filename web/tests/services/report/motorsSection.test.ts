import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import en from '../../../src/i18n/locales/en.json';
import type { ReportModel } from '../../../src/services/report/reportModel';
import type { ReportOptions } from '../../../src/services/report/options';
import { createPdfPage, type T } from '../../../src/services/report/pdfPage';
import { writeMotorsSection } from '../../../src/services/report/motorsSection';
import { METRIC_UNITS, type UnitSelection } from '../../../src/prefs/units';

/** The motors section's text, drawn into a real jsPDF document. */
function drawnText(configs: ReportModel['configs'], units: UnitSelection = METRIC_UNITS): string {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const runs: string[] = [];
  const text = doc.text.bind(doc);
  doc.text = ((...a: Parameters<typeof text>) => {
    const s = a[0];
    runs.push(...(Array.isArray(s) ? s : [s]).map(String));
    return text(...a);
  }) as typeof doc.text;
  const t: T = (key) => {
    const raw = key.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], en);
    return typeof raw === 'string' ? raw : key;
  };
  const page = createPdfPage(doc, t, {} as ReportOptions, units);
  writeMotorsSection(page, { configs } as unknown as ReportModel);
  return runs.join(' ').replace(/\s+/g, ' ');
}

const motor = {
  designation: 'C6',
  manufacturer: 'Estes',
  avgThrust: 6,
  maxThrust: 14,
  burnTime: 1.9,
  totalImpulse: 10,
  impulseClass: 'C',
  weight: 0.024,
  diameter: 0.018,
  length: 0.07,
  loadedMass: 0.1,
};

const flight = {
  maxAltitude: 120,
  flightTime: 20,
  timeToApogee: 5,
  launchRodVelocity: 12,
  maxVelocity: 60,
  deploymentVelocity: 8,
  groundHitVelocity: 4,
};

describe('the motors section', () => {
  it('says an outdated result is outdated above its figures', () => {
    const out = drawnText([{ name: 'Old', motors: [motor], flight, outdated: true }]);
    expect(out).toContain(en.report.outdatedFlight);
    expect(out.indexOf(en.report.outdatedFlight)).toBeLessThan(out.indexOf(en.report.altitude));
  });

  it('prints a current result with no note', () => {
    const out = drawnText([{ name: 'New', motors: [motor], flight, outdated: false }]);
    expect(out).not.toContain(en.report.outdatedFlight);
    expect(out).toContain(en.report.altitude);
  });

  // An Estes C6 is 18 x 70 mm, 0.709 x 2.756 in; an AeroTech N2000 is 98 x 1,046 mm.
  it('prints motor sizes whole in millimeters and to the ladder in inches', () => {
    const big = { ...motor, designation: 'N2000W', manufacturer: 'AeroTech', diameter: 0.098, length: 1.046 };
    const mm = drawnText([{ name: 'Big', motors: [motor, big], flight, outdated: false }]);
    expect(mm).toContain('18/70 mm');
    expect(mm).toContain('98/1,046 mm');
    const inch = drawnText([{ name: 'C6', motors: [motor], flight, outdated: false }], {
      ...METRIC_UNITS,
      motorDimensions: 'in',
    });
    expect(inch).toContain('0.709/2.76 in');
  });
});
