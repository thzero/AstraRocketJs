import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import en from '../../../src/i18n/locales/en.json';
import type { ReportModel } from '../../../src/services/report/reportModel';
import type { ReportOptions } from '../../../src/services/report/options';
import { createPdfPage, type T } from '../../../src/services/report/pdfPage';
import { writeMotorsSection } from '../../../src/services/report/motorsSection';
import { METRIC_UNITS } from '../../../src/prefs/units';

/** The motors section's text, drawn into a real jsPDF document. */
function drawnText(configs: ReportModel['configs']): string {
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
  const page = createPdfPage(doc, t, {} as ReportOptions, METRIC_UNITS);
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
});
