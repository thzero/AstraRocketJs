import { describe, it, expect, vi } from 'vitest';
import type { ComponentNode, ComponentType, RocketTree } from '../../src/engine/openRocketEngine';
import { FIELDS, type Field } from '../../src/services/design/componentFields';
import {
  KERNEL_AUTO_KEYS,
  fieldApplies,
  fieldRange,
  fieldValue,
  liveBounds,
} from '../../src/services/design/fieldRange';
import { defaultNode, syncDerived } from '../../src/services/design/treeEdit';
import { REQUIRED_COMPONENT_FIELDS } from '../../src/services/design/requiredComponent';
import { parentRadiusOf } from '../../src/tree/finPlanform';
import { num, positionOf } from '../../src/tree/nodeProps';
import { loadEngine } from '../testing/kernelGeometry';
import { KERNEL_TEST_TIMEOUT_MS } from '../testing/kernelTimeout';

vi.setConfig({ testTimeout: KERNEL_TEST_TIMEOUT_MS, hookTimeout: KERNEL_TEST_TIMEOUT_MS });

/**
 * The panel shows what flies.
 *
 * For every field the Design tab edits, the value the panel shows
 * (`fieldValue`, after the app's own automatic rules in `syncDerived`) has to be
 * the value the kernel holds once the rocket is built (`getComponentFields` on
 * the bridge, read back through the part's own getters). That catches every way
 * the two can part:
 *
 * - a key the node leaves out, which the kernel fills from its constructor and
 *   the app from a fallback of its own;
 * - a value the panel lets the node store that a kernel setter clamps;
 * - an automatic rule the app resolves one way and the bridge another,
 *   including a setter applied before the part has a parent.
 *
 * Each part is built in a wide airframe (50 mm radius) so a value that fell back
 * to the kernel's 25 mm automatic radius cannot pass by coincidence. Each type
 * is built from the part the editor creates and from SEEDS, which put the fields
 * that apply only in some states (a tab, a cluster, a shape with a parameter, an
 * altitude event) into them; the test fails if any field is never compared.
 * Expected values are the kernel's, never an app constant.
 *
 * KNOWN lists accepted disagreements by `type.key`, each citing a finding in
 * docs/AUDIT.md and matching only the disagreement that finding describes. The
 * list is checked both ways: a new disagreement fails, and so does an entry
 * that has stopped disagreeing.
 */
type Miss = { rule: string; label: string; app: unknown; kernel: unknown };
type Known = { why: string; when: (app: number, kernel: number) => boolean };

const absentShowsZero = (app: number, kernel: number) => app === 0 && kernel > 0;
const KNOWN: Record<string, Known> = {
  'launchlug.instanceSeparation': {
    why: 'C2: the constructor separation (length x 2) flies; the app reads 0',
    when: absentShowsZero,
  },
  'railbutton.instanceSeparation': {
    why: 'C2: the constructor separation (outer diameter x 6) flies; the app reads 0',
    when: absentShowsZero,
  },
  'launchlug.angleOffset': {
    why: 'C3: LaunchLug.setAngleOffset clamps past 180 deg; C34: absent, the bridge flies pi',
    when: (app, kernel) => kernel === Math.PI && (app > Math.PI || app === 0),
  },
  'railbutton.angleOffset': {
    why: 'C3: RailButton.setAngleOffset clamps past 180 deg; C34: absent, the bridge flies pi',
    when: (app, kernel) => kernel === Math.PI && (app > Math.PI || app === 0),
  },
  'nosecone.shoulderThickness': {
    why: 'C33: a shoulder length set from 0 takes the part wall (Transition.setForeShoulderLength)',
    when: absentShowsZero,
  },
  'transition.foreShoulderThickness': { why: 'C33', when: absentShowsZero },
  'transition.aftShoulderThickness': { why: 'C33', when: absentShowsZero },
  'bulkhead.instanceCount': { why: 'C34: no kernel default row, so a new part reads 0 copies', when: absentShowsZero },
  'centeringring.instanceCount': { why: 'C34', when: absentShowsZero },
  'launchlug.instanceCount': { why: 'C34', when: absentShowsZero },
  'railbutton.instanceCount': { why: 'C34', when: absentShowsZero },
  'parachute.cd': { why: 'C34: absent, the kernel flies Parachute.DEFAULT_CD', when: absentShowsZero },
  'parachute.lineCount': { why: 'C34: absent, the bridge flies 6', when: absentShowsZero },
  'parachute.radius': { why: 'C34: a new part carries no packed radius', when: absentShowsZero },
  'streamer.radius': { why: 'C34', when: absentShowsZero },
  'shockcord.radius': { why: 'C34', when: absentShowsZero },
  'tubefinset.thickness': { why: 'C34: absent, the TubeFinSet constructor wall flies', when: absentShowsZero },
  'bulkhead.outerRadius': {
    why: 'C39: an absent outer radius builds automatic; the panel shows 0',
    when: absentShowsZero,
  },
  'centeringring.outerRadius': { why: 'C39', when: absentShowsZero },
  'engineblock.outerRadius': { why: 'C39', when: absentShowsZero },
  'tubecoupler.outerRadius': { why: 'C39', when: absentShowsZero },
  'tubefinset.outerRadius': { why: 'C39', when: absentShowsZero },
};

/**
 * Fields the kernel reads only in some states of the part, by the condition. The
 * panel still shows them; outside the condition the kernel keeps whatever it
 * holds and nothing flies it. SEEDS put every one of them into its state.
 */
const hasTab = (n: ComponentNode) => num(n, 'tabHeight') > 0 && num(n, 'tabLength') > 0;
const READ_ONLY_WHEN: Record<string, (n: ComponentNode) => boolean> = {
  // ComponentFactory.applyFinTabs builds a tab only when both are positive.
  tabLength: hasTab,
  tabHeight: hasTab,
  tabOffset: hasTab,
  tabOffsetMethod: hasTab,
  // Read only by the altitude events (DeployEvent.ALTITUDE, SeparationEvent's
  // two altitude events). FlightConfigurableParameterSet.setDefault also keeps
  // the old default when only the altitude differs from it.
  deployAltitude: (n) => n['deployEvent'] === 'altitude',
  separationAltitude: (n) => typeof n['separationEvent'] === 'string' && n['separationEvent'].startsWith('altitude'),
};

/** States beyond the editor's new part, so that every field applies in at least one. */
const TAB = { tabLength: 0.02, tabHeight: 0.005, tabOffset: 0, tabOffsetMethod: 'middle' };
const ALTITUDE_DEPLOY = { deployEvent: 'altitude', deployAltitude: 300 };
const ALTITUDE_SEPARATION = { separationEvent: 'altitudeascending', separationAltitude: 300 };
const SEEDS: Record<string, Record<string, Partial<ComponentNode>>> = {
  nosecone: {
    'power shape': { shape: 'power' },
    'haack shape': { shape: 'haack' },
    'parabolic shape': { shape: 'parabolic' },
  },
  transition: {
    'ogive shape': { shape: 'ogive' },
    'ellipsoid shape': { shape: 'ellipsoid' },
    'power shape': { shape: 'power' },
    'parabolic shape': { shape: 'parabolic' },
    'haack shape': { shape: 'haack' },
  },
  innertube: { '3-ring cluster': { cluster: '3-ring' } },
  trapezoidfinset: { 'with a tab': TAB },
  ellipticalfinset: { 'with a tab': TAB },
  freeformfinset: { 'with a tab': TAB },
  parachute: { 'altitude deploy': ALTITUDE_DEPLOY },
  streamer: { 'altitude deploy': ALTITUDE_DEPLOY },
  stage: { 'altitude separation': ALTITUDE_SEPARATION },
  parallelstage: { 'altitude separation': ALTITUDE_SEPARATION },
};

/** Kinds that store no node key of their own. */
const NO_KEY = new Set(['text', 'bore', 'derived']);

const NOSE: ComponentNode = {
  type: 'nosecone',
  id: 'nose',
  shape: 'ogive',
  length: 0.15,
  aftRadius: 0.05,
  thickness: 0.002,
};
const TUBE: ComponentNode = { type: 'bodytube', id: 'tube', length: 0.4, outerRadius: 0.05, thickness: 0.002 };
const TAIL: ComponentNode = { type: 'bodytube', id: 'tail', length: 0.3, outerRadius: 0.04, thickness: 0.002 };
const POD_TUBE: ComponentNode = { type: 'bodytube', id: 'pod-tube', length: 0.1, outerRadius: 0.01, thickness: 0.001 };

/** The design a part is tested in, with the part under id `p`. */
function host(part: ComponentNode): RocketTree {
  const p = { ...part, id: 'p' };
  const stage = (id: string, children: ComponentNode[]) => ({ type: 'stage', id, children }) as ComponentNode;
  switch (part.type) {
    case 'stage':
      return { components: [stage('stage1', [NOSE, TUBE]), { ...p, children: [TAIL] }] } as RocketTree;
    case 'nosecone':
      return { components: [stage('stage1', [p, TUBE])] } as RocketTree;
    case 'bodytube':
      return { components: [stage('stage1', [NOSE, p])] } as RocketTree;
    case 'transition':
      return { components: [stage('stage1', [NOSE, TUBE, p, TAIL])] } as RocketTree;
    case 'podset':
    case 'parallelstage':
      return {
        components: [stage('stage1', [NOSE, { ...TUBE, children: [{ ...p, children: [POD_TUBE] }] }])],
      } as RocketTree;
    default:
      return { components: [stage('stage1', [NOSE, { ...TUBE, children: [p] }])] } as RocketTree;
  }
}

function find(nodes: readonly ComponentNode[], id: string): ComponentNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = find((n.children ?? []) as ComponentNode[], id);
    if (hit) return hit;
  }
  return undefined;
}

/** A value the panel can store beyond any ceiling it does not set, by kind. */
const PAST_OPEN_MAX: Partial<Record<Field['kind'], number>> = {
  angle: 1.5 * Math.PI,
  length: 0.2,
  number: 2.5,
  distance: 500,
  mass: 0.5,
};

type Case = { label: string; node: ComponentNode };

/** A seed as it is, with each key left out in turn, at each end of each range the panel allows, and on Auto. */
function cases(type: string, fields: Field[], seedLabel: string, seed: ComponentNode): Case[] {
  const out: Case[] = [{ label: seedLabel, node: seed }];
  for (const f of fields) {
    if (NO_KEY.has(f.kind)) continue;
    if (f.key in seed) {
      const without: ComponentNode = { ...seed };
      delete without[f.key];
      if (f.auto) delete without[f.auto.flag];
      out.push({ label: `${seedLabel}, without ${f.key}`, node: without });
    }
    const unflagged: ComponentNode = f.auto ? { ...seed, [f.auto.flag]: false } : seed;
    // The panel's own limits, the fin tab's live depth included.
    const tabDepth = parentRadiusOf(syncDerived(host(unflagged)), 'p');
    const r = fieldRange(unflagged, f, liveBounds(f, tabDepth));
    const ends = [r.min, r.max ?? PAST_OPEN_MAX[f.kind]].filter((v): v is number => v !== undefined);
    // A dimension the run refuses at 0 (requiredComponent) never flies at 0.
    const refusedAtZero = (REQUIRED_COMPONENT_FIELDS[type] ?? []).includes(f.key);
    for (const v of ends.filter((e) => !(refusedAtZero && e === 0)))
      out.push({ label: `${seedLabel}, ${f.key} = ${+v.toFixed(6)}`, node: { ...unflagged, [f.key]: v } });
    if (f.auto) out.push({ label: `${seedLabel}, ${f.key} on Auto`, node: { ...seed, [f.auto.flag]: true } });
  }
  return out;
}

/** The editor's new part, then each seed laid over it. */
function seeds(type: string): [string, ComponentNode][] {
  const base = { ...defaultNode(type as ComponentType), id: 'p' };
  return [
    ['new part', base],
    ...Object.entries(SEEDS[type] ?? {}).map(([label, patch]): [string, ComponentNode] => [
      label,
      { ...base, ...patch },
    ]),
  ];
}

const norm = (v: unknown): unknown => (typeof v === 'string' ? v.toLowerCase().replace(/_/g, '') : v);

/**
 * The same value. Angles are the same when they differ by whole turns: most
 * kernel angle setters reduce to (-pi, pi] (MathUtil.reducePi), and the panel
 * keeps what was typed. A clamp still shows, since it moves the angle.
 */
function agrees(app: unknown, kernel: unknown, angle: boolean): boolean {
  if (typeof app === 'number' && typeof kernel === 'number') {
    const turn = 2 * Math.PI;
    const d = angle ? Math.abs(((((app - kernel) % turn) + 1.5 * turn) % turn) - turn / 2) : Math.abs(app - kernel);
    return d <= 1e-9 + 1e-9 * Math.abs(kernel);
  }
  return norm(app) === norm(kernel);
}

describe('the panel shows what the kernel flies', () => {
  it('for every field, with keys absent, at the ends of each range, and on Auto', async () => {
    const engine = await loadEngine();
    const misses: Miss[] = [];
    const compared = new Set<string>();
    for (const [type, fields] of Object.entries(FIELDS)) {
      for (const [seedLabel, seed] of seeds(type)) {
        for (const c of cases(type, fields, seedLabel, seed)) {
          const tree = syncDerived(host(c.node));
          const app = find(tree.components, 'p')!;
          engine.reset();
          const handle = engine.buildRocket(JSON.stringify(tree));
          const built = JSON.parse(engine.getComponentFields(handle, 'p')) as Record<string, unknown>;
          if (typeof built.error === 'string') {
            misses.push({ rule: `${type} builds`, label: c.label, app: 'builds', kernel: built.error });
            continue;
          }
          for (const f of fields) {
            if (NO_KEY.has(f.kind) || !(f.key in built) || !fieldApplies(app, f)) continue;
            if (READ_ONLY_WHEN[f.key] && !READ_ONLY_WHEN[f.key]!(app)) continue;
            if (f.auto && app[f.auto.flag] === true && KERNEL_AUTO_KEYS.has(f.key)) continue;
            compared.add(`${type}.${f.key}`);
            const shown = fieldValue(app, f);
            if (!agrees(shown, built[f.key], f.kind === 'angle')) {
              misses.push({ rule: `${type}.${f.key}`, label: c.label, app: shown, kernel: built[f.key] });
            }
          }
          // Where a part inside the airframe sits. Parts in the stage's own chain
          // are laid end to end and read no position.
          if (!['stage', 'nosecone', 'bodytube', 'transition'].includes(type)) {
            compared.add(`${type}.position`);
            const pos = positionOf(app);
            const shown = `${pos.method} ${+pos.offset.toFixed(9)}`;
            const kernel = `${String(built.positionMethod)} ${+Number(built.positionOffset).toFixed(9)}`;
            if (shown !== kernel) misses.push({ rule: `${type}.position`, label: c.label, app: shown, kernel });
          }
        }
      }
    }
    const matched = new Set<string>();
    const unknown = misses.filter((m) => {
      const k = KNOWN[m.rule];
      if (k && typeof m.app === 'number' && typeof m.kernel === 'number' && k.when(m.app, m.kernel)) {
        matched.add(m.rule);
        return false;
      }
      return true;
    });
    const report = unknown.map((m) => `${m.rule} [${m.label}]: app ${String(m.app)}, kernel ${String(m.kernel)}`);
    expect(report, report.join('\n')).toEqual([]);
    expect(Object.keys(KNOWN).filter((rule) => !matched.has(rule))).toEqual([]);
    // Every field the panel edits has to be compared in at least one case, or a
    // field that never reaches the state it applies in passes unseen.
    const never = Object.entries(FIELDS).flatMap(([type, fields]) =>
      fields.filter((f) => !NO_KEY.has(f.kind) && !compared.has(`${type}.${f.key}`)).map((f) => `${type}.${f.key}`),
    );
    expect(never).toEqual([]);
  });
});
