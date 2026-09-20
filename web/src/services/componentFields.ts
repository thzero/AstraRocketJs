import type { TFunction } from 'i18next';
import { AUTO_COMPONENT_FIELDS, REQUIRED_COMPONENT_FIELDS } from './requiredComponent';
import { CLUSTER_OPTIONS, clusterCount } from '../tree/cluster';

/**
 * The component field table: which properties each component type exposes,
 * what kind each is, and which ones a zero makes nonsense of.
 *
 * This is DOMAIN DATA, not presentation. It encodes the OpenRocket component
 * vocabulary, the shape lists, the deploy and separation event vocabularies,
 * the unit kinds and the required-ness - and it lived inside `PropertyPanel`,
 * a React component, where three test files already had to import it and
 * `services/requiredComponent` cross-checks its own invariants against it. A
 * service depending on a component module for the shape of its own domain is
 * backwards, and it was most of why that file ran to 898 lines.
 */

/**
 * `required` means a ZERO here is degenerate, not that the box can be empty.
 *
 * Unlike the launch conditions -- where a cleared field had to be told apart
 * from a typed zero, because still air and sea level are real values -- a part
 * has no meaningful "blank length". Zero IS the invalid state, so there is no
 * second state to model and the field keeps storing a number.
 *
 * Marked conservatively: only where a zero makes the part stop being that part.
 * Plenty of dimensions here are legitimately zero and are NOT marked -- a
 * tipChord of 0 is a delta fin, a sweep or cant of 0 is a straight one, a
 * shoulder or fin tab of 0 is simply absent, and every delay and angle offset
 * starts at 0.
 */
type FieldFlags = { required?: true };

export type Field = FieldFlags &
  (
    | { key: string; label: string; kind: 'length' } // stored m, shown in units.length
    | { key: string; label: string; kind: 'mass' } // stored kg, shown in units.mass
    | { key: string; label: string; kind: 'count' }
    | { key: string; label: string; kind: 'distance'; step?: number } // stored m, shown in units.distance
    | { key: string; label: string; kind: 'number'; step?: number; unit?: string }
    | { key: string; label: string; kind: 'angle'; step?: number } // stored radians, shown in units.angle
    | { key: string; label: string; kind: 'bool' }
    | {
        key: string;
        label: string;
        kind: 'select';
        options: string[];
        optI18n?: string;
        /** Option text when it has to be computed rather than looked up. */
        optLabel?: (option: string, t: TFunction) => string;
      }
  );

// The real OpenRocket shape vocabulary — matches the engine (shapeOf), the
// drawing (shapeProfile), and the parts catalog. NOT 'elliptical'/'powerseries'.
const NOSE_SHAPES = ['ogive', 'conical', 'ellipsoid', 'power', 'parabolic', 'haack'];

// Recovery-device deployment triggers — the kernel DeployEvent vocabulary
// (ComponentFactory.deployEventOf); the same strings .ork import/export use.
// Apogee first: it's the default and the most common single-deploy trigger.
const DEPLOY_EVENTS = ['apogee', 'ejection', 'altitude', 'launch', 'never'];

// Stage-separation triggers (SeparationEvent, ComponentFactory.separationEventOf)
// — when a stage lets go of the one above it. Ejection first: the desktop default
// and the low/mid-power norm (drop off on the upper stage's ejection charge).
const SEPARATION_EVENTS = [
  'ejection',
  'burnout',
  'launch',
  'ignition',
  'upperignition',
  'apogee',
  'altitudeascending',
  'altitudedescending',
  'never',
];

// Optional through-the-wall fin tab (0 length/height = no tab). Shared by the
// trapezoidal and elliptical fin editors; keys match the engine + .ork.
const FIN_TABS: Field[] = [
  { key: 'tabLength', label: 'tabLength', kind: 'length' },
  { key: 'tabHeight', label: 'tabHeight', kind: 'length' },
  { key: 'tabOffset', label: 'tabOffset', kind: 'length' },
  { key: 'tabOffsetMethod', label: 'tabOffsetMethod', kind: 'select', options: ['top', 'middle', 'bottom'] },
];

// Off-axis assembly placement (PodSet / ParallelStage) — how many instances
// ring the parent axis, how far off it, and where they start. radiusMethod:
// 'relative' measures the offset as a gap from the parent surface, 'free' from
// the parent centerline (see tree/assembly.resolveAssemblyRadius). Shared by
// pods (non-separating) and parallel boosters (which add separation below).
const ASSEMBLY_FIELDS: Field[] = [
  { key: 'instanceCount', label: 'instanceCount', kind: 'count' },
  { key: 'radiusOffset', label: 'radialDistance', kind: 'length' },
  {
    key: 'radiusMethod',
    label: 'radialReference',
    kind: 'select',
    options: ['relative', 'free'],
    optI18n: 'radiusMethod',
  },
  { key: 'angleOffset', label: 'angleAroundBody', kind: 'angle' },
];

// `label` is an i18n key suffix under `prop.*` (resolved at render).
/**
 * Unit-scope keys the panel uses for its own rows, beyond the type-specific
 * fields. Named here so the scope test can check no FIELDS entry reuses one.
 */
export const PANEL_SCOPE_KEYS = ['overrideMass', 'overrideCGX', 'offset'] as const;

/**
 * Exported for `PropertyPanel.scopes.test.ts`, which checks that no two fields
 * of a type collide on a unit scope. The scopes are strings assembled from
 * (type, key), so a duplicated key would silently make two fields share one
 * unit choice.
 */
const RAW_FIELDS: Record<string, Field[]> = {
  // Separation only — shown for a non-first stage (see the render guard). The
  // altitude is used only by the altitude events; harmless (like deployAltitude).
  stage: [
    {
      key: 'separationEvent',
      label: 'separationEvent',
      kind: 'select',
      options: SEPARATION_EVENTS,
      optI18n: 'separationEvent',
    },
    { key: 'separationDelay', label: 'separationDelay', kind: 'number', unit: 's', step: 0.5 },
    { key: 'separationAltitude', label: 'separationAltitude', kind: 'distance', step: 10 },
  ],
  nosecone: [
    { key: 'shape', label: 'shape', kind: 'select', options: NOSE_SHAPES },
    // Only meaningful for the shapes whose profile it actually controls
    // (ogive/power/parabolic/haack) - filtered at render by shapeUsesParameter.
    { key: 'shapeParameter', label: 'shapeParameter', kind: 'number', step: 0.05 },
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'aftRadius', label: 'radius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'shoulderLength', label: 'shoulderLength', kind: 'length' },
    { key: 'shoulderRadius', label: 'shoulderRadius', kind: 'length' },
    { key: 'shoulderThickness', label: 'shoulderThickness', kind: 'length' },
    { key: 'shoulderCapped', label: 'shoulderCapped', kind: 'bool' },
  ],
  bodytube: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'motorMount', label: 'motorMount', kind: 'bool' },
    { key: 'motorOverhang', label: 'motorOverhang', kind: 'length' },
  ],
  transition: [
    {
      key: 'shape',
      label: 'shape',
      kind: 'select',
      options: ['conical', 'ogive', 'ellipsoid', 'power', 'parabolic', 'haack'],
    },
    // Same as the nose cone: a transition offers the same four parametric
    // shapes, `orkImport` reads <shapeparameter> into it, `orkExport` writes it
    // back, and the mesh/report/schematic/3D view all render it - so without
    // this row a power or haack transition had the same uneditable, frozen
    // parameter the nose cone did. Filtered at render by shapeUsesParameter.
    { key: 'shapeParameter', label: 'shapeParameter', kind: 'number', step: 0.05 },
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'foreRadius', label: 'foreRadius', kind: 'length' },
    { key: 'aftRadius', label: 'aftRadius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'foreShoulderLength', label: 'foreShoulderLength', kind: 'length' },
    { key: 'foreShoulderRadius', label: 'foreShoulderRadius', kind: 'length' },
    { key: 'aftShoulderLength', label: 'aftShoulderLength', kind: 'length' },
    { key: 'aftShoulderRadius', label: 'aftShoulderRadius', kind: 'length' },
  ],
  trapezoidfinset: [
    { key: 'finCount', label: 'finCount', kind: 'count' },
    { key: 'rootChord', label: 'rootChord', kind: 'length' },
    { key: 'tipChord', label: 'tipChord', kind: 'length' },
    { key: 'sweep', label: 'sweep', kind: 'length' },
    { key: 'height', label: 'height', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'cant', label: 'cant', kind: 'angle', step: 0.5 },
    ...FIN_TABS,
  ],
  ellipticalfinset: [
    { key: 'finCount', label: 'finCount', kind: 'count' },
    { key: 'rootChord', label: 'rootChord', kind: 'length' },
    { key: 'height', label: 'height', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'cant', label: 'cant', kind: 'angle', step: 0.5 },
    ...FIN_TABS,
  ],
  freeformfinset: [
    { key: 'finCount', label: 'finCount', kind: 'count' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'cant', label: 'cant', kind: 'angle', step: 0.5 },
    ...FIN_TABS,
  ],
  tubefinset: [
    { key: 'finCount', label: 'tubeCount', kind: 'count' },
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'tubeRadius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
  ],
  innertube: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'motorMount', label: 'motorMount', kind: 'bool' },
    { key: 'motorOverhang', label: 'motorOverhang', kind: 'length' },
    // `cluster` round-trips through .ork (orkImport:366 / orkExport:466) and
    // the 2D, aft and 3D views all draw the tube at every cluster offset — but
    // nothing could SET it, so the only way to get a cluster was to import a
    // file that already had one.
    {
      key: 'cluster',
      label: 'cluster',
      kind: 'select',
      options: CLUSTER_OPTIONS,
      optLabel: (o, t) =>
        o === 'single' ? t('cluster.single') : t('cluster.pattern', { name: o, n: clusterCount(o) }),
    },
  ],
  tubecoupler: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
  ],
  centeringring: [
    { key: 'length', label: 'thickness', kind: 'length' },
    { key: 'outerRadius', label: 'outerRadius', kind: 'length' },
    { key: 'innerRadius', label: 'innerRadius', kind: 'length' },
  ],
  bulkhead: [
    { key: 'length', label: 'thickness', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
  ],
  engineblock: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
  ],
  launchlug: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'radius', kind: 'length' },
    { key: 'angleOffset', label: 'angleAroundBody', kind: 'angle' },
  ],
  railbutton: [
    { key: 'outerDiameter', label: 'outerDiameter', kind: 'length' },
    { key: 'angleOffset', label: 'angleAroundBody', kind: 'angle' },
  ],
  parachute: [
    { key: 'diameter', label: 'diameter', kind: 'length' },
    { key: 'cd', label: 'dragCoeff', kind: 'number', step: 0.05 },
    { key: 'lineCount', label: 'lineCount', kind: 'count' },
    { key: 'lineLength', label: 'lineLength', kind: 'length' },
    // Which half of a dual-deployment pair this is. The kernel judges the
    // deployment speed against different thresholds depending on it, and cannot
    // warn about dual deployment at all unless something on the stage says drogue.
    { key: 'drogue', label: 'drogue', kind: 'bool' },
    { key: 'deployEvent', label: 'deployEvent', kind: 'select', options: DEPLOY_EVENTS, optI18n: 'deployEvent' },
    { key: 'deployAltitude', label: 'deployAltitude', kind: 'distance', step: 10 },
    { key: 'deployDelay', label: 'deployDelay', kind: 'number', unit: 's', step: 0.5 },
  ],
  streamer: [
    { key: 'stripLength', label: 'length', kind: 'length' },
    { key: 'stripWidth', label: 'width', kind: 'length' },
    { key: 'cd', label: 'dragCoeff', kind: 'number', step: 0.05 },
    { key: 'drogue', label: 'drogue', kind: 'bool' },
    { key: 'deployEvent', label: 'deployEvent', kind: 'select', options: DEPLOY_EVENTS, optI18n: 'deployEvent' },
    { key: 'deployAltitude', label: 'deployAltitude', kind: 'distance', step: 10 },
    { key: 'deployDelay', label: 'deployDelay', kind: 'number', unit: 's', step: 0.5 },
  ],
  masscomponent: [
    { key: 'mass', label: 'mass', kind: 'mass' },
    { key: 'length', label: 'length', kind: 'length' },
  ],
  // External pods: assembly placement only (their own chain is edited as
  // children).
  podset: ASSEMBLY_FIELDS,
  // Parallel booster: assembly placement + the same separation trigger a
  // booster <stage> carries (when it lets go of the core).
  parallelstage: [
    ...ASSEMBLY_FIELDS,
    {
      key: 'separationEvent',
      label: 'separationEvent',
      kind: 'select',
      options: SEPARATION_EVENTS,
      optI18n: 'separationEvent',
    },
    { key: 'separationDelay', label: 'separationDelay', kind: 'number', unit: 's', step: 0.5 },
    { key: 'separationAltitude', label: 'separationAltitude', kind: 'distance', step: 10 },
  ],
};

/**
 * The same table with `required` filled in from `services/requiredComponent`,
 * which is also what the Run button and the run loop check. One list, so the
 * editor cannot mark a field the run path ignores, or the other way round.
 *
 * A field the kernel DERIVES is never marked, even though it is required in the
 * sense that the part cannot work without one: leaving a centering ring's outer
 * radius blank means "the tube I sit in", which is a real answer and the one
 * OpenRocket writes as `auto`. A red asterisk there would demand a number the
 * design does not need, and the run path agrees - `badDimensions` skips the same
 * pairs.
 */
export const FIELDS: Record<string, Field[]> = Object.fromEntries(
  Object.entries(RAW_FIELDS).map(([type, fields]) => [
    type,
    fields.map((f) =>
      (REQUIRED_COMPONENT_FIELDS[type] ?? []).includes(f.key) && !(AUTO_COMPONENT_FIELDS[type] ?? []).includes(f.key)
        ? { ...f, required: true }
        : f,
    ),
  ]),
);
