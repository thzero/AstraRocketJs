import { describe, it, expect, vi } from 'vitest';
import type { ComponentNode, RocketTree } from '../../../src/engine/openRocketEngine';
import type { ReportModel } from '../../../src/services/report/reportModel';
import type { UnitSelection } from '../../../src/prefs/units';

/**
 * What the PDF report draws, read from the calls it makes against a stand-in
 * jsPDF: every mark inside the page, templates and the ruler at 1:1, the
 * engine's figures printed as given, and each section present when chosen.
 */

const calls: string[] = [];
class FakeDoc {
  internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
  fontSize = 16;
  constructor(opts: unknown) {
    calls.push(`new jsPDF ${JSON.stringify(opts)}`);
  }
  splitTextToSize(text: string, w: number): string[] {
    calls.push(`splitTextToSize ${JSON.stringify([text, w])}`);
    return [text.slice(0, 40), text.slice(40)];
  }
  /**
   * Helvetica Bold capitals average about 0.65 em, so a column title wraps or
   * shrinks here roughly where it does in the real document. Not logged:
   * where the text lands is what the pin is for.
   */
  getTextWidth(text: string): number {
    return text.length * 0.65 * this.fontSize * (25.4 / 72);
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
      if (m === 'setFontSize') this.fontSize = args[0] as number;
      calls.push(`${m} ${JSON.stringify(args)}`);
      return this;
    },
  });
}
vi.mock('jspdf', () => ({ jsPDF: FakeDoc }));

const saved: string[] = [];
vi.mock('../../../src/services/files/saveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/files/saveFile')>()),
  saveBlob: (_blob: Blob, name: string) => {
    saved.push(name);
    return Promise.resolve();
  },
}));

const { downloadReportPdf } = await import('../../../src/services/report/reportPdf');

const node = (o: object) => o as unknown as ComponentNode;

const info = (scale: number) => ({
  length: 1.2 * scale,
  // Shorter than `length`, as it is on any design with a non-aerodynamic part
  // outside the aerodynamic envelope, so the drawn text distinguishes the
  // engine's stabilityPercent (13.6) from the wrong (cp - cg) / length (12.5).
  lengthAerodynamic: 1.1 * scale,
  mass: 1.5 * scale,
  massEmpty: 1.1 * scale,
  cgEmpty: 0.6 * scale,
  cg: 0.7 * scale,
  cp: 0.85 * scale,
  cna: 12.3,
  stabilityCalibers: 1.97,
  stabilityPercent: 13.6,
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
            position: { method: 'top', offset: 0 },
          }),
          node({
            type: 'tubefinset',
            id: 'tfins',
            name: 'Tube fins',
            finCount: 6,
            outerRadius: 0.019,
            length: 0.1,
            position: { method: 'top', offset: 0 },
          }),
          node({
            type: 'ellipticalfinset',
            id: 'efins',
            name: 'Ellipse',
            finCount: 3,
            rootChord: 0.09,
            height: 0.05,
            position: { method: 'top', offset: 0 },
          }),
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
            position: { method: 'top', offset: 0 },
          }),
        ],
      }),
      node({ type: 'transition', id: 'btr', name: 'Wide', length: 0.6, foreRadius: 0.038, aftRadius: 0.3 }),
    ],
  }),
];

const tree = { name: 'Golden Report', components: stages } as unknown as RocketTree;

const motor = (designation: string, avg: number, loadedMass: number) => ({
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
  loadedMass,
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
      motors: [motor('J350W', 350, 2.1), motor('H128', 128, 2.1)],
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
    { name: 'No flight', motors: [motor('H128', 128, 1.7)], flight: null },
    { name: 'Empty', motors: [], flight: null },
    {
      name: 'No deploy',
      motors: [motor('J350W', 350, 2.0)],
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
    { parts: true, finTemplates: true },
    { parts: true, finTemplates: true },
  ],
  paper: 'a4' as const,
  orientation: 'portrait' as const,
  templateFill: '#ffcc00',
  templateStroke: '#123456',
};

/**
 * The marking guide's own tree, kept apart from the report-wide one so its
 * awkward cases do not change what the other tests in this file draw:
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

type Call = { m: string; args: unknown[] };
/** The drawing calls, each `method [args]`; the constructor and `output` lines are skipped. */
const parsed = (): Call[] =>
  calls
    .filter((c) => c.includes(' ['))
    .map((c) => {
      const i = c.indexOf(' ');
      return { m: c.slice(0, i), args: JSON.parse(c.slice(i + 1)) as unknown[] };
    });
const of = (m: string) => parsed().filter((c) => c.m === m);
/** Every string `text` draws, a wrapped one joined back up. */
const texts = () => of('text').map((c) => (Array.isArray(c.args[0]) ? c.args[0].join('') : String(c.args[0])));
const colors = (m: string) => of(m).map((c) => JSON.stringify(c.args));
const draw = async (opts: Partial<Parameters<typeof downloadReportPdf>[3]>, m = model, tr = tree, u = units) => {
  calls.length = 0;
  saved.length = 0;
  await downloadReportPdf(m, tr, t, { ...everything, ...opts }, u);
};

/** Every text anchor and line end lies on the 210 x 297 mm page the stand-in reports. */
function expectOnPage() {
  const inside = (x: unknown, y: unknown) =>
    (x as number) >= 0 && (x as number) <= 210 && (y as number) >= 0 && (y as number) <= 297;
  for (const c of of('text')) expect(inside(c.args[1], c.args[2]), JSON.stringify(c.args)).toBe(true);
  for (const c of of('line')) {
    expect(inside(c.args[0], c.args[1]) && inside(c.args[2], c.args[3]), JSON.stringify(c.args)).toBe(true);
  }
}

describe('the PDF report', () => {
  it('draws every section by stage, on the page, with the chosen template colors', async () => {
    await draw({});
    // "-report", the way the design CSV beside it is "-design": a name says
    // which rocket and which document, not only which rocket.
    expect(saved).toEqual(['Golden_Report_1_-report.pdf']);
    expect(calls[0]).toBe('new jsPDF {"unit":"mm","format":"a4","orientation":"portrait"}');
    expectOnPage();
    const all = texts();
    for (const key of ['report.title', 'report.stages', 'report.motors', 'report.partsDetail', 'report.templates']) {
      expect(
        all.some((s) => s.startsWith(key)),
        key,
      ).toBe(true);
    }
    // The engine's stabilityPercent, not (cp - cg) / length (12.5).
    expect(all).toContain('13.6 %');
    expect(all).not.toContain('12.5 %');
    // The 70-row parts table runs onto pages of its own rather than off the bottom.
    expect(all).toContain('Ring 69');
    expect(of('addPage').length).toBeGreaterThan(2);
    expect(colors('setFillColor')).toContain('[255,204,0]');
    expect(colors('setDrawColor')).toContain('[18,52,86]');
  });

  it('draws the flat report on letter landscape with outline templates and only the chosen parts', async () => {
    await draw({
      showByStage: false,
      templateFill: '',
      templateStroke: 'bad',
      paper: 'letter',
      orientation: 'landscape',
      stages: [
        { parts: true, finTemplates: false },
        { parts: false, finTemplates: true },
      ],
    });
    expect(calls[0]).toBe('new jsPDF {"unit":"mm","format":"letter","orientation":"landscape"}');
    expect(colors('setFillColor')).not.toContain('[255,204,0]');
    // An unreadable stroke falls back to near-black.
    expect(colors('setDrawColor')).toContain('[17,24,39]');
    const all = texts();
    expect(all).not.toContain('Ring 0');
    // The booster's 500 x 300 mm fin cannot print 1:1, so it is named, not shrunk.
    expect(all).toContain('report.tooLarge{"w":"500","h":"300"}');
  });

  it('draws marking guides: a 1:1 ruler, an oversize tube in pieces, canted fins and footnotes', async () => {
    await draw(
      { designReport: false, includeMotors: false, noseTemplates: false, transitionTemplates: false, stages: [] },
      markingModel,
      markingTree,
    );
    expectOnPage();
    // The ruler is what a reader checks the print scale against: 100 mm long.
    const ruler = of('line').find(
      (c) => c.args[1] === c.args[3] && (c.args[2] as number) - (c.args[0] as number) === 100,
    );
    expect(ruler).toBeTruthy();
    const all = texts();
    expect(all).toContain('report.markingPart{"k":1,"n":2}');
    expect(all).toContain('report.markingPart{"k":2,"n":2}');
    // The 3 degree cant prints its fin line on the slant.
    expect(of('text').some((c) => c.args[0] === 'Canted fins' && (c.args[3] as { angle?: number })?.angle === -3)).toBe(
      true,
    );
    expect(of('setLineDashPattern').length).toBeGreaterThan(0);
    expect(all).toContain('report.markingOmitted_noWrap{"names":"Nose button"}');
    expect(all).toContain('report.markingOmitted_noFins{"names":"Upper lug"}');
  });

  it.each([
    ['kg', 'N·s', '1.50 kg'],
    ['lb', 'lbf·s', '3.31 lb'],
  ])('prints the summary and motor tables in %s and %s', async (mass, impulse, loaded) => {
    await draw({ noseTemplates: false, transitionTemplates: false, finMarkingGuide: false, stages: [] }, model, tree, {
      ...units,
      mass,
      impulse,
    } as UnitSelection);
    const all = texts();
    expect(all).toContain(loaded);
    expect(all.some((s) => s.endsWith(` ${impulse}`))).toBe(true);
  });

  it('draws only the heading when nothing is selected', async () => {
    await draw({
      designReport: false,
      includeMotors: false,
      noseTemplates: false,
      transitionTemplates: false,
      finMarkingGuide: false,
      stages: [],
    });
    expect(texts()).toEqual(['report.title']);
    expect(of('addPage')).toHaveLength(0);
  });
});
