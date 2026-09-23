import { describe, it, expect, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import type { ReportModel } from './reportModel';
import type { UnitSelection } from '../prefs/units';

/**
 * The fin template's page-fit check took its width and height from
 * `Math.max(...pts.map(...))`. A freeform outline is file-sourced, and
 * spreading a large one into a call overflows the stack with an opaque
 * "Maximum call stack size exceeded" (dxfExport.ts hit the same thing and
 * loops instead). Nothing else in the suite drives the template section, so
 * this is the case that holds the loop in place.
 */

const saveBlob = vi.fn((_blob: Blob, _name: string) => Promise.resolve());
vi.mock('./saveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./saveFile')>()),
  saveBlob: (blob: Blob, name: string) => saveBlob(blob, name),
}));

const { downloadReportPdf } = await import('./reportPdf');

describe('downloadReportPdf fin templates', () => {
  it('prints a freeform fin with more points than a spread could carry', async () => {
    const n = 200_000;
    const points = Array.from({ length: n }, (_, i) => {
      const f = i / (n - 1);
      return [f * 0.06, Math.sin(f * Math.PI) * 0.04 + (i % 2) * 2e-5];
    });
    const fin = { type: 'freeformfinset', id: 'huge', name: 'Huge', finCount: 3, thickness: 0.003, points };
    const stage = {
      type: 'stage',
      id: 's',
      name: 'S',
      children: [{ type: 'bodytube', id: 'body', length: 0.3, outerRadius: 0.013, children: [fin] }],
    } as unknown as ComponentNode;
    const tree = { name: 'Big fin', components: [stage] } as unknown as RocketTree;
    const model = {
      name: 'Big fin',
      stages: [stage],
      whole: {},
      stageSummaries: [],
      configs: [],
      partsByStage: [],
      finSetsByStage: [],
    } as unknown as ReportModel;

    await downloadReportPdf(
      model,
      tree,
      (k: string) => k,
      {
        designReport: false,
        includeMotors: false,
        showByStage: false,
        noseTemplates: false,
        transitionTemplates: false,
        stages: [{ include: true, parts: false, finTemplates: true }],
        paper: 'a4',
        orientation: 'portrait',
        templateFill: '',
        templateStroke: '#000000',
      },
      {} as UnitSelection,
    );

    expect(saveBlob).toHaveBeenCalledTimes(1);
    expect(String(saveBlob.mock.calls[0]![1])).toMatch(/\.pdf$/);
  });
});
