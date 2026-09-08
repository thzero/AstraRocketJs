import { describe, it, expect } from 'vitest';
import type { StaticInfo } from '../engine/openRocketEngine';
import type { ReportModel } from './reportModel';
import { buildDesignCsv } from './reportCsv';

const info = {
  length: 0.9, refDiameter: 0.079, mass: 4.25, massEmpty: 3.43, cg: 1.382, cgEmpty: 1.244,
  cp: 1.629, cna: 26.42, stabilityCalibers: 3.14, rollInertia: 0.0054, pitchInertia: 1.83, cd: 1.115,
} as unknown as StaticInfo;

const model: ReportModel = {
  name: 'Fireball',
  stages: [{ type: 'stage' }, { type: 'stage' }] as never,
  whole: { label: 'Fireball', info },
  stageSummaries: [{ label: 'Sustainer', info }, { label: 'Booster', info }],
  configs: [],
  partsByStage: [],
  finSetsByStage: [{ stage: 'Sustainer', sets: [{ name: 'Fin set', topX: 1.118, bottomX: 1.271 }] }],
};

describe('design CSV', () => {
  const csv = buildDesignCsv(model);
  const rows = csv.trimEnd().split('\r\n').map((l) => l.split(','));

  it('starts with the Scope/Field/Value/Unit header', () => {
    expect(rows[0]).toEqual(['Scope', 'Field', 'Value', 'Unit']);
  });

  it('has the Design block', () => {
    expect(rows).toContainEqual(['Design', 'Name', 'Fireball', '']);
    expect(rows).toContainEqual(['Design', 'Design Type', 'Original Design/Other', '']);
    expect(rows).toContainEqual(['Design', 'Stages', '2', '']);
  });

  it('has the Rocket summary in metric with dot decimals', () => {
    expect(rows).toContainEqual(['Rocket', 'Length', '900', 'mm']);
    expect(rows).toContainEqual(['Rocket', 'Stability (on pad)', '3.14', 'cal']);
    expect(rows).toContainEqual(['Rocket', 'CP', '162.9', 'cm']);
    expect(rows).toContainEqual(['Rocket', 'Normal-Force Slope (CNα)', '26.42', '/rad']);
  });

  it('emits a summary block per stage', () => {
    expect(rows).toContainEqual(['Sustainer', 'Length', '900', 'mm']);
    expect(rows).toContainEqual(['Booster', 'Length', '900', 'mm']);
  });

  it('emits fin-set root positions per stage', () => {
    expect(rows).toContainEqual(['Sustainer', 'Fin set: Nose to top of fin root', '111.8', 'cm']);
    expect(rows).toContainEqual(['Sustainer', 'Fin set: Nose to bottom of fin root', '127.1', 'cm']);
  });

  it('quotes a value containing a comma', () => {
    const c = buildDesignCsv({ ...model, name: 'Big, Rocket' });
    expect(c).toContain('Design,Name,"Big, Rocket",');
  });
});
