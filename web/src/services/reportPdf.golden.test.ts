import { describe, it, expect, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../engine/openRocketEngine';
import type { ReportModel } from './reportModel';
import type { UnitSelection } from '../prefs/units';

/**
 * GOLDEN drawing log of the PDF report, pinned before `downloadReportPdf` was
 * split into page sections. jsPDF's own bytes carry a creation date, so the
 * pin is the exact sequence of drawing calls (method, arguments, order) the
 * report makes against the document, which is what decides where every line
 * of text and every 1:1 template lands on the page.
 */

const calls: string[] = [];
class FakeDoc {
  internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
  constructor(opts: unknown) {
    calls.push(`new jsPDF ${JSON.stringify(opts)}`);
  }
  splitTextToSize(text: string, w: number): string[] {
    calls.push(`splitTextToSize ${JSON.stringify([text, w])}`);
    return [text.slice(0, 40), text.slice(40)];
  }
  output(kind: string): Blob {
    calls.push(`output ${kind}`);
    return new Blob(['%PDF']);
  }
}
for (const m of [
  'setFont',
  'setFontSize',
  'setTextColor',
  'setDrawColor',
  'setFillColor',
  'setLineWidth',
  'line',
  'lines',
  'text',
  'addPage',
  'setLineDashPattern',
]) {
  Object.defineProperty(FakeDoc.prototype, m, {
    value: function (this: FakeDoc, ...args: unknown[]) {
      calls.push(`${m} ${JSON.stringify(args)}`);
      return this;
    },
  });
}
vi.mock('jspdf', () => ({ jsPDF: FakeDoc }));

const saved: string[] = [];
vi.mock('./saveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./saveFile')>()),
  saveBlob: (_blob: Blob, name: string) => {
    saved.push(name);
    return Promise.resolve();
  },
}));

const { downloadReportPdf } = await import('./reportPdf');

const node = (o: object) => o as unknown as ComponentNode;

const info = (scale: number) => ({
  length: 1.2 * scale,
  mass: 1.5 * scale,
  massEmpty: 1.1 * scale,
  cgEmpty: 0.6 * scale,
  cg: 0.7 * scale,
  cp: 0.85 * scale,
  cna: 12.3,
  stabilityCalibers: 1.97,
  refDiameter: 0.076,
  rollInertia: 0.001,
  pitchInertia: 0.2,
  warnings: 0,
  warningTexts: [],
  cd: scale === 1 ? 0.4567 : undefined,
});

const stages = [
  node({
    type: 'stage',
    id: 's0',
    name: 'Sustainer',
    children: [
      node({ type: 'nosecone', id: 'nose', name: 'Nose', length: 0.2, aftRadius: 0.038, shape: 'ogive' }),
      node({
        type: 'bodytube',
        id: 'body',
        name: 'Body',
        length: 0.6,
        outerRadius: 0.038,
        children: [
          node({
            type: 'trapezoidfinset',
            id: 'fins',
            name: 'Fins',
            finCount: 3,
            rootChord: 0.1,
            tipChord: 0.05,
            sweep: 0.04,
            height: 0.08,
            thickness: 0.003,
            tabHeight: 0.02,
            tabLength: 0.05,
            position: { method: 'bottom', offset: 0 },
          }),
          node({
            type: 'freeformfinset',
            id: 'ffins',
            name: '',
            finCount: 4,
            thickness: 0.003,
            points: [
              [0, 0],
              [0.03, 0.06],
              [0.09, 0.06],
              [0.1, 0],
            ],
          }),
          node({ type: 'tubefinset', id: 'tfins', name: 'Tube fins', finCount: 6, outerRadius: 0.019, length: 0.1 }),
          node({ type: 'ellipticalfinset', id: 'efins', name: 'Ellipse', finCount: 3, rootChord: 0.09, height: 0.05 }),
        ],
      }),
      node({ type: 'transition', id: 'tr', name: 'Boat tail', length: 0.05, foreRadius: 0.038, aftRadius: 0.025 }),
    ],
  }),
  node({
    type: 'stage',
    id: 's1',
    name: 'Booster',
    children: [
      node({
        type: 'bodytube',
        id: 'bbody',
        name: 'Booster tube',
        length: 0.4,
        outerRadius: 0.038,
        children: [
          node({
            type: 'trapezoidfinset',
            id: 'bfins',
            name: 'Huge',
            finCount: 4,
            rootChord: 0.5,
            tipChord: 0.3,
            sweep: 0.1,
            height: 0.3,
            thickness: 0.005,
          }),
        ],
      }),
      node({ type: 'transition', id: 'btr', name: 'Wide', length: 0.6, foreRadius: 0.038, aftRadius: 0.3 }),
    ],
  }),
];

const tree = { name: 'Golden Report', components: stages } as unknown as RocketTree;

const motor = (designation: string, avg: number) => ({
  designation,
  manufacturer: designation.startsWith('J') ? 'AeroTech' : undefined,
  avgThrust: avg,
  maxThrust: avg * 1.6,
  burnTime: 1.85,
  totalImpulse: avg * 1.85,
  impulseClass: 'J',
  weight: 0.42,
  diameter: 0.038,
  length: 0.2,
});

const model = {
  name: 'Golden Report <1>',
  stages,
  whole: { label: 'Rocket', info: info(1) },
  stageSummaries: [
    { label: 'Sustainer', info: info(0.5) },
    { label: 'Booster', info: info(0.7) },
  ],
  configs: [
    {
      name: 'Two stage',
      motors: [motor('J350W', 350), motor('H128', 128)],
      loadedMass: 2.1,
      flight: {
        maxAltitude: 1234.5,
        flightTime: 98.7,
        timeToApogee: 14.2,
        launchRodVelocity: 19.9,
        maxVelocity: 210.4,
        deploymentVelocity: 8.3,
        groundHitVelocity: 5.1,
      },
    },
    { name: 'No flight', motors: [motor('H128', 128)], loadedMass: 1.7, flight: null },
    { name: 'Empty', motors: [], loadedMass: 1.1, flight: null },
    {
      name: 'No deploy',
      motors: [motor('J350W', 350)],
      loadedMass: 2.0,
      flight: {
        maxAltitude: 900,
        flightTime: 60,
        timeToApogee: 12,
        launchRodVelocity: 18,
        maxVelocity: 180,
        deploymentVelocity: null,
        groundHitVelocity: 6,
      },
    },
  ],
  partsByStage: [
    {
      stage: 'Sustainer',
      rows: [
        {
          depth: 0,
          type: 'nosecone',
          name: 'Nose',
          material: 'Polystyrene',
          density: 1050,
          length: 0.2,
          outerR: 0.038,
          thickness: 0.002,
          mass: 0.05,
        },
        {
          depth: 0,
          type: 'bodytube',
          name: '',
          material: 'Cardboard',
          density: 680,
          length: 0.6,
          outerR: 0.038,
          innerR: 0.037,
          thickness: 0.001,
          mass: 0.12,
        },
        { depth: 1, type: 'trapezoidfinset', name: 'Fins', length: 0, mass: 0.03 },
      ],
    },
    {
      stage: 'Booster',
      rows: Array.from({ length: 70 }, (_, i) => ({
        depth: i % 3,
        type: 'centeringring',
        name: `Ring ${i}`,
        material: 'Plywood',
        density: 630,
        length: 0.003,
        outerR: 0.038,
        innerR: 0.019,
        mass: 0.004,
      })),
    },
  ],
  finSetsByStage: [],
} as unknown as ReportModel;

const units = {
  length: 'mm',
  motorDimensions: 'mm',
  distance: 'ft',
  mass: 'g',
  velocity: 'm/s',
  windspeed: 'm/s',
  acceleration: 'm/s²',
  angle: '°',
  density: 'g/cm³',
  surfaceDensity: 'g/m²',
  lineDensity: 'g/m',
  temperature: '°C',
  pressure: 'hPa',
  force: 'N',
  impulse: 'Ns',
} as UnitSelection;

const t = (key: string, o?: Record<string, unknown>) =>
  o && 'defaultValue' in o ? String(o['defaultValue']) : o ? `${key}${JSON.stringify(o)}` : key;

const everything = {
  designReport: true,
  includeMotors: true,
  showByStage: true,
  noseTemplates: true,
  transitionTemplates: true,
  finMarkingGuide: true,
  stages: [
    { include: true, parts: true, finTemplates: true },
    { include: true, parts: true, finTemplates: true },
  ],
  paper: 'a4' as const,
  orientation: 'portrait' as const,
  templateFill: '#ffcc00',
  templateStroke: '#123456',
};

/**
 * The marking guide's own tree, kept apart from the report-wide one so its
 * awkward cases do not perturb every other snapshot in this file:
 *
 * - a 98 mm tube, whose 308 mm wrap no page here can hold in one piece
 * - canted fins, which mark on a slant with their own dashed fore/aft lines
 * - a lug and a rail button consolidated onto the same strip as the fins
 * - a tube with a lug but no fins, which gets no strip and a footnote instead
 */
const markingTree = {
  name: 'Marked',
  components: [
    node({
      type: 'stage',
      id: 'guide-stage',
      name: 'Sustainer',
      children: [
        node({
          type: 'nosecone',
          id: 'guide-nose',
          name: 'Nose',
          length: 0.2,
          aftRadius: 0.049,
          children: [node({ type: 'railbutton', id: 'guide-nose-button', name: 'Nose button' })],
        }),
        node({
          type: 'bodytube',
          id: 'guide-payload',
          name: 'Payload',
          length: 0.4,
          outerRadius: 0.049,
          children: [node({ type: 'launchlug', id: 'guide-payload-lug', name: 'Upper lug' })],
        }),
        node({
          type: 'bodytube',
          id: 'guide-body',
          name: 'Booster tube',
          length: 0.6,
          outerRadius: 0.049,
          children: [
            node({
              type: 'trapezoidfinset',
              id: 'guide-fins',
              name: 'Canted fins',
              finCount: 3,
              rootChord: 0.06,
              tipChord: 0.03,
              sweep: 0.02,
              height: 0.07,
              cant: (3 * Math.PI) / 180,
              rotation: Math.PI / 6,
            }),
            node({ type: 'launchlug', id: 'guide-lug', name: 'Lug', angleOffset: Math.PI / 2 }),
            node({ type: 'railbutton', id: 'guide-button', name: 'Button', angleOffset: (2 * Math.PI) / 3 }),
          ],
        }),
      ],
    }),
  ],
} as unknown as RocketTree;

const markingModel = {
  name: 'Marked',
  stages: [],
  whole: { label: 'Rocket', info: info(1) },
  stageSummaries: [],
  configs: [],
  partsByStage: [],
  finSetsByStage: [],
} as unknown as ReportModel;

describe('golden PDF report', () => {
  it('draws every section, by stage, with filled templates exactly as before', async () => {
    calls.length = 0;
    await downloadReportPdf(model, tree, t, everything, units);
    expect(calls.join('\n')).toMatchSnapshot();
    // "-report", the way the design CSV beside it is "-design": a name says
    // which rocket AND which document, not only which rocket.
    expect(saved).toEqual(['Golden_Report_1_-report.pdf']);
  });

  it('draws the flat (not by stage) report with outline templates on letter landscape', async () => {
    calls.length = 0;
    await downloadReportPdf(
      model,
      tree,
      t,
      {
        ...everything,
        showByStage: false,
        templateFill: '',
        templateStroke: 'bad',
        paper: 'letter',
        orientation: 'landscape',
        stages: [
          { include: true, parts: true, finTemplates: false },
          { include: false, parts: false, finTemplates: true },
        ],
      },
      units,
    );
    expect(calls.join('\n')).toMatchSnapshot();
  });

  it('draws marking guides: an oversize tube in pieces, canted fins, and a footnote', async () => {
    calls.length = 0;
    await downloadReportPdf(
      markingModel,
      markingTree,
      t,
      {
        ...everything,
        designReport: false,
        includeMotors: false,
        noseTemplates: false,
        transitionTemplates: false,
        stages: [],
      },
      units,
    );
    expect(calls.join('\n')).toMatchSnapshot();
  });

  it('draws only the fallback heading when nothing is selected', async () => {
    calls.length = 0;
    await downloadReportPdf(
      model,
      tree,
      t,
      {
        ...everything,
        designReport: false,
        includeMotors: false,
        noseTemplates: false,
        transitionTemplates: false,
        finMarkingGuide: false,
        stages: [],
      },
      units,
    );
    expect(calls.join('\n')).toMatchSnapshot();
  });
});
