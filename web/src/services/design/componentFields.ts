import type { TFunction } from 'i18next';
import { AUTO_COMPONENT_FIELDS, REQUIRED_COMPONENT_FIELDS } from './requiredComponent';
import { CLUSTER_OPTIONS, clusterCount } from '../../tree/cluster';
import type { DerivedName } from './derivedFields';
import { KERNEL_DEPLOYMENT } from '../../tree/kernelDefaults';

/**
 * The component field table: which properties each component type exposes,
 * what kind each is, and which ones a zero makes nonsense of.
 *
 * This is domain data, not presentation. It encodes the OpenRocket component
 * vocabulary, the shape lists, the deploy and separation event vocabularies,
 * the unit kinds and the required-ness. It does not live in `PropertyPanel`:
 * services (`treeEdit`) and tests import it directly, and it takes its required
 * list from `services/design/requiredComponent`, so a service would otherwise be
 * depending on a component module for the shape of its own domain.
 */

/**
 * The panel sections a field can be pulled out of the dimension list into.
 *
 * - `placement` is where the part goes: the angle around the body, rendered
 *   beside "Position from" and "Offset" rather than in the middle of the
 *   dimensions, between a radius and a thickness.
 * - `finTab` is the optional through-the-wall tab, four fields that describe a
 *   separate piece of the fin and read as a run-on of the planform without a
 *   break.
 * - `motor` is what a tube does for a motor rather than what it is: whether it
 *   mounts one, how far the motor hangs out, and how many tubes the cluster is.
 * - `fillet` is the glue bead along a fin's root: a radius, and the material it
 *   is made of, which is rarely the fin's own (epoxy on plywood).
 * - `shoulder` is the stub that plugs into the tube next door: four fields that
 *   describe a different piece of the part from the cone or taper above them,
 *   and that a transition has two of. `foreShoulder` and `aftShoulder` are
 *   those two, kept apart rather than run together, because eight rows under
 *   one heading is a wall and the two ends are independent builds.
 *
 * A field with no `section` is a dimension and renders in the main list.
 */
export type PanelSection =
  'placement' | 'finTab' | 'motor' | 'fillet' | 'shoulder' | 'foreShoulder' | 'aftShoulder' | 'comment';

type FieldFlags = {
  /**
   * A zero here is degenerate; it does not mean the box can be empty.
   *
   * Unlike the launch conditions (where a cleared field has to be told apart
   * from a typed zero, because still air and sea level are real values), a part
   * has no meaningful "blank length". Zero is the invalid state, so there is no
   * second state to model and the field keeps storing a number.
   *
   * Marked conservatively: only where a zero makes the part stop being that part.
   * Plenty of dimensions here are legitimately zero and are not marked: a
   * tipChord of 0 is a delta fin, a sweep or cant of 0 is a straight one, a
   * shoulder or fin tab of 0 is simply absent, and every delay and angle offset
   * starts at 0.
   */
  required?: true;
  section?: PanelSection;
  /**
   * The value is stored as a radius and edited as a diameter.
   *
   * The node keys mirror the `.ork` tags, which are radii in meters, while
   * everything around the panel speaks diameter: the parts picker's own column
   * (`outerDiameter`, halved on apply in treeEdit.ts), the component tree's row
   * (`outerRadius * 2`), the DXF sheet's `Ø` labels, the motor catalog, the
   * rail button (which stores a diameter), and OpenRocket itself. Nobody
   * measures a tube with a radius.
   *
   * It is a per-field flag rather than a rule about key names, because a fillet
   * radius really is a radius: it is the bead along a fin root, not a circle
   * anybody measures across. Storage does not move: the `.ork` tag, the kernel
   * bridge and the catalog all carry radii, and only the two numbers at the edit
   * boundary are doubled and halved.
   */
  diameter?: true;
  /**
   * A flag that makes this dimension follow something else, and the field
   * read-only while it is set.
   *
   * Used by the shoulder diameters, which follow the bore of the tube they plug
   * into (see services/design/autoShoulder.ts), and by the radii and recovery
   * figures the kernel resolves. The stored value is still a plain number (the
   * resolver writes it), so every consumer outside this panel is unaffected, and
   * clearing the box pins whatever it currently is.
   *
   * `flag` is the node key that turns following on; `tip` names the `prop.*`
   * string that says what is being followed, which differs per field.
   */
  auto?: { flag: string; tip: 'autoShoulder' | 'autoRadius' | 'autoComputed' };
};

export type Field = FieldFlags &
  (
    | { key: string; label: string; kind: 'length' } // stored m, shown in units.length
    // A tube's bore. Not a node key at all: it is read from the outer radius
    // and the wall, and typing one writes the wall back. See the `bore` branch
    // in DimensionFields for why the wall is the side that gives.
    | { key: string; label: string; kind: 'bore' }
    // A second door onto numbers the part already stores: a fin's sweep as an
    // angle, a streamer's area and aspect ratio, a mass component's density.
    // `key` names the row, not a node key; `derived` names the pair of
    // conversions in services/design/derivedFields.ts.
    | { key: string; label: string; kind: 'derived'; derived: DerivedName; step?: number }
    | { key: string; label: string; kind: 'mass' } // stored kg, shown in units.mass
    | { key: string; label: string; kind: 'count' }
    | { key: string; label: string; kind: 'distance'; step?: number } // stored m, shown in units.distance
    | { key: string; label: string; kind: 'number'; step?: number; unit?: string }
    | { key: string; label: string; kind: 'angle'; step?: number } // stored radians, shown in units.angle
    | { key: string; label: string; kind: 'bool' }
    // Free text, a paragraph rather than a line: OpenRocket gives every
    // component a Comment tab.
    | { key: string; label: string; kind: 'text' }
    | {
        key: string;
        label: string;
        kind: 'select';
        options: string[];
        optI18n?: string;
        /** What an absent key flies as. The first option when not given. */
        fallback?: string;
        /** Option text when it has to be computed rather than looked up. */
        optLabel?: (option: string, t: TFunction) => string;
      }
  );

// The real OpenRocket shape vocabulary: matches the engine (shapeOf), the
// drawing (shapeProfile), and the parts catalog. Not 'elliptical'/'powerseries'.
const NOSE_SHAPES = ['ogive', 'conical', 'ellipsoid', 'power', 'parabolic', 'haack'];

// Recovery-device deployment triggers: the kernel DeployEvent vocabulary
// (ComponentFactory.deployEventOf); the same strings .ork import/export use.
// Apogee first: it is what a new part is created with and the most common
// single-deploy trigger. A device with no event flies the kernel's default,
// which the field names as its fallback.
const DEPLOY_EVENTS = ['apogee', 'ejection', 'altitude', 'launch', 'lower_stage_separation', 'never'];

// What a mass component represents (MassComponent.MassComponentType). Naming
// only, no physics, and the same strings the .ork carries.
const MASS_COMPONENT_TYPES = [
  'masscomponent',
  'altimeter',
  'flightcomputer',
  'deploymentcharge',
  'tracker',
  'payload',
  'recoveryhardware',
  'battery',
];

// Stage-separation triggers (SeparationEvent, ComponentFactory.separationEventOf)
// (when a stage lets go of the one above it). Ejection first: the desktop default
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
  { key: 'tabLength', label: 'tabLength', kind: 'length', section: 'finTab' },
  { key: 'tabHeight', label: 'tabHeight', kind: 'length', section: 'finTab' },
  { key: 'tabOffset', label: 'tabOffset', kind: 'length', section: 'finTab' },
  {
    key: 'tabOffsetMethod',
    label: 'tabOffsetMethod',
    kind: 'select',
    options: ['top', 'middle', 'bottom'],
    optI18n: 'tabOffsetMethod',
    section: 'finTab',
  },
];

// The glue bead along the fin root. The kernel computes its volume, mass and
// CM (FinSet.calculateFilletVolumeCentroid) from the radius the engine bridge
// sets. Tube fins have none: a TubeFinSet is a Tube, not a FinSet, so the
// kernel has no fillet to give it.
const FIN_FILLET: Field = { key: 'filletRadius', label: 'filletRadius', kind: 'length', section: 'fillet' };

/** Notes on this part. Upstream puts it on `RocketComponent`, so every type has
 *  one; here it is appended to every list rather than repeated in each. */
const COMMENT: Field = { key: 'comment', label: 'comment', kind: 'text', section: 'comment' };

// The fin's section through the chord. OpenRocket's own FinSet.CrossSection,
// which carries the volume factors 1.00 / 0.99 / 0.85 and so changes the fin's
// mass as well as its drag. The kernel reads it from the tree.
const FIN_CROSS_SECTION: Field = {
  key: 'crossSection',
  label: 'crossSection',
  kind: 'select',
  options: ['square', 'rounded', 'airfoil'],
  optI18n: 'crossSection',
};

// Off-center placement of internal structure: how far off the axis, and
// which way round. Both round-trip through `.ork` and reach the kernel.
const RADIAL_PLACEMENT: Field[] = [
  { key: 'radialPosition', label: 'radialPosition', kind: 'length', section: 'placement' },
  { key: 'radialDirection', label: 'radialDirection', kind: 'angle', step: 15, section: 'placement' },
];

// N copies of one part, evenly spaced along the body. OpenRocket's
// <instancecount>/<instanceseparation>.
const LINE_INSTANCES: Field[] = [
  { key: 'instanceCount', label: 'instanceCount', kind: 'count', section: 'placement' },
  { key: 'instanceSeparation', label: 'instanceSeparation', kind: 'length', section: 'placement' },
];

// A recovery device or mass object's packed size: the space it takes up in the
// airframe, and where its mass therefore sits.
const PACKED: Field[] = [
  { key: 'length', label: 'packedLength', kind: 'length' },
  {
    key: 'radius',
    label: 'packedDiameter',
    kind: 'length',
    diameter: true,
    // Automatic here means "as much room as the parent gives it"
    // (MassObject.getMaxParentRadius).
    auto: { flag: 'radiusAuto', tip: 'autoRadius' },
  },
];

/**
 * The inner diameter of a straight tube, between its outside and its wall:
 * the order those three read in, and the order OpenRocket puts them in.
 *
 * Every tube in the table carries an outer radius and a wall thickness, and the
 * bore is derived from the pair in `discGeometry.tubeRadii`, where the DXF
 * sheet, the printed solids and the 3D cutaway all read it. It is the
 * dimension a tube is actually bought and fitted by: what slides
 * into it, what it slides over, whether the motor goes in.
 *
 * Not on a nose cone or transition, whose wall follows a curved profile and
 * has no single bore, and not on a centering ring or bulkhead, whose
 * `innerRadius` is a stored dimension of its own rather than a consequence of
 * a wall.
 */
const TUBE_BORE: Field = { key: 'innerDiameter', label: 'innerDiameter', kind: 'bore' };

// `rotation` is a fin set's base rotation: where its first fin sits around the
// body, with the rest spaced evenly from it. It round-trips through .ork
// (importTags.ts / exportParts.ts) and the 3D view places every fin and tube fin
// at it (rocketPieces.ts). The fin marking guide prints where each fin goes
// relative to the launch lug, and that relationship is this field.
const FIN_ROTATION: Field = { key: 'rotation', label: 'rotation', kind: 'angle', step: 5, section: 'placement' };

// Off-axis assembly placement (PodSet / ParallelStage): how many instances
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
  { key: 'angleOffset', label: 'rotation', kind: 'angle', section: 'placement' },
];

// When a stage (or a parallel booster) lets go. The altitude is read only by
// the altitude events.
const SEPARATION_FIELDS: Field[] = [
  {
    key: 'separationEvent',
    label: 'separationEvent',
    kind: 'select',
    options: SEPARATION_EVENTS,
    optI18n: 'separationEvent',
  },
  { key: 'separationDelay', label: 'separationDelay', kind: 'number', unit: 's', step: 0.5 },
  { key: 'separationAltitude', label: 'separationAltitude', kind: 'distance', step: 10 },
];

// When a recovery device comes out. The altitude is read only by the altitude
// event.
const DEPLOY_FIELDS: Field[] = [
  {
    key: 'deployEvent',
    label: 'deployEvent',
    kind: 'select',
    options: DEPLOY_EVENTS,
    optI18n: 'deployEvent',
    fallback: KERNEL_DEPLOYMENT.deployEvent,
  },
  { key: 'deployAltitude', label: 'deployAltitude', kind: 'distance', step: 10 },
  { key: 'deployDelay', label: 'deployDelay', kind: 'number', unit: 's', step: 0.5 },
];

/**
 * Unit-scope keys the panel uses for its own rows, beyond the type-specific
 * fields. Named here so the scope test can check no FIELDS entry reuses one.
 */
export const PANEL_SCOPE_KEYS = ['overrideMass', 'overrideCGX', 'offset'] as const;

/**
 * The fields per component type, before `required` is filled in. `label` is an
 * i18n key suffix under `prop.*` (resolved at render).
 *
 * `PropertyPanel.scopes.test.ts` checks (through {@link FIELDS}) that no two
 * fields of a type collide on a unit scope. The scopes are strings assembled
 * from (type, key), so a duplicated key would silently make two fields share
 * one unit choice.
 */
const RAW_FIELDS: Record<string, Field[]> = {
  // Separation only, shown for a non-first stage (see the render guard).
  stage: SEPARATION_FIELDS,
  nosecone: [
    { key: 'shape', label: 'shape', kind: 'select', options: NOSE_SHAPES, optI18n: 'noseShape' },
    // Only meaningful for the shapes whose profile it actually controls
    // (ogive/power/parabolic/haack); filtered at render by shapeUsesParameter.
    { key: 'shapeParameter', label: 'shapeParameter', kind: 'number', step: 0.05 },
    { key: 'length', label: 'length', kind: 'length' },
    {
      key: 'aftRadius',
      label: 'diameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'aftRadiusAuto', tip: 'autoRadius' },
    },
    // Solid all the way through, with no bore. The desktop's Filled
    // checkbox, and `<thickness>filled</thickness>` in the file. The wall row
    // is dropped while it is on, the way the desktop grays it out.
    { key: 'filled', label: 'filled', kind: 'bool' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    // A flipped nose cone is a tail cone: the same part turned round.
    { key: 'flipped', label: 'flipped', kind: 'bool' },
    { key: 'shoulderLength', label: 'shoulderLength', kind: 'length', section: 'shoulder' },
    {
      key: 'shoulderRadius',
      label: 'shoulderDiameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'shoulderAuto', tip: 'autoShoulder' },
      section: 'shoulder',
    },
    { key: 'shoulderThickness', label: 'shoulderThickness', kind: 'length', section: 'shoulder' },
    { key: 'shoulderCapped', label: 'shoulderCapped', kind: 'bool', section: 'shoulder' },
  ],
  bodytube: [
    { key: 'length', label: 'length', kind: 'length' },
    {
      key: 'outerRadius',
      label: 'diameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'outerRadiusAuto', tip: 'autoRadius' },
    },
    TUBE_BORE,
    // Solid all the way through, with no bore. The desktop's Filled
    // checkbox, and `<thickness>filled</thickness>` in the file. The wall row
    // is dropped while it is on, the way the desktop grays it out.
    { key: 'filled', label: 'filled', kind: 'bool' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'motorMount', label: 'motorMount', kind: 'bool', section: 'motor' },
    { key: 'motorOverhang', label: 'motorOverhang', kind: 'length', section: 'motor' },
  ],
  transition: [
    {
      key: 'shape',
      label: 'shape',
      kind: 'select',
      options: ['conical', 'ogive', 'ellipsoid', 'power', 'parabolic', 'haack'],
      optI18n: 'noseShape',
    },
    // Same as the nose cone: a transition offers the same four parametric
    // shapes, the .ork reader and writer carry <shapeparameter>, and the
    // mesh/report/schematic/3D view all render it. Filtered at render by
    // shapeUsesParameter.
    { key: 'shapeParameter', label: 'shapeParameter', kind: 'number', step: 0.05 },
    { key: 'length', label: 'length', kind: 'length' },
    {
      key: 'foreRadius',
      label: 'foreDiameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'foreRadiusAuto', tip: 'autoRadius' },
    },
    {
      key: 'aftRadius',
      label: 'aftDiameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'aftRadiusAuto', tip: 'autoRadius' },
    },
    // Solid all the way through, with no bore. The desktop's Filled
    // checkbox, and `<thickness>filled</thickness>` in the file. The wall row
    // is dropped while it is on, the way the desktop grays it out.
    { key: 'filled', label: 'filled', kind: 'bool' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    // Clipped or full profile, for the shapes where it means anything
    // (ellipsoid, power, haack). The drawing, the mesh and the kernel all read
    // it.
    { key: 'clipped', label: 'clipped', kind: 'bool' },
    { key: 'foreShoulderLength', label: 'foreShoulderLength', kind: 'length', section: 'foreShoulder' },
    {
      key: 'foreShoulderRadius',
      label: 'foreShoulderDiameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'foreShoulderAuto', tip: 'autoShoulder' },
      section: 'foreShoulder',
    },
    // Each shoulder's own wall, and whether its far end is closed by a disc of
    // the part's material. Both round-trip through `.ork` and reach the kernel,
    // which weighs the shoulders from them. The nose cone has the same two rows;
    // this is the two-sided version.
    { key: 'foreShoulderThickness', label: 'foreShoulderThickness', kind: 'length', section: 'foreShoulder' },
    { key: 'foreShoulderCapped', label: 'foreShoulderCapped', kind: 'bool', section: 'foreShoulder' },
    { key: 'aftShoulderLength', label: 'aftShoulderLength', kind: 'length', section: 'aftShoulder' },
    {
      key: 'aftShoulderRadius',
      label: 'aftShoulderDiameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'aftShoulderAuto', tip: 'autoShoulder' },
      section: 'aftShoulder',
    },
    { key: 'aftShoulderThickness', label: 'aftShoulderThickness', kind: 'length', section: 'aftShoulder' },
    { key: 'aftShoulderCapped', label: 'aftShoulderCapped', kind: 'bool', section: 'aftShoulder' },
  ],
  trapezoidfinset: [
    { key: 'finCount', label: 'finCount', kind: 'count' },
    { key: 'rootChord', label: 'rootChord', kind: 'length' },
    { key: 'tipChord', label: 'tipChord', kind: 'length' },
    { key: 'sweep', label: 'sweep', kind: 'length' },
    // The same sweep, as a plan does it. Signed: negative is a forward sweep,
    // which is the one row here where a minus sign is meaningful.
    { key: 'sweepAngle', label: 'sweepAngle', kind: 'derived', derived: 'sweepAngle', step: 5 },
    { key: 'height', label: 'height', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'cant', label: 'cant', kind: 'angle', step: 0.5 },
    FIN_CROSS_SECTION,
    FIN_ROTATION,
    FIN_FILLET,
    ...FIN_TABS,
  ],
  ellipticalfinset: [
    { key: 'finCount', label: 'finCount', kind: 'count' },
    { key: 'rootChord', label: 'rootChord', kind: 'length' },
    { key: 'height', label: 'height', kind: 'length' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'cant', label: 'cant', kind: 'angle', step: 0.5 },
    FIN_CROSS_SECTION,
    FIN_ROTATION,
    FIN_FILLET,
    ...FIN_TABS,
  ],
  freeformfinset: [
    { key: 'finCount', label: 'finCount', kind: 'count' },
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'cant', label: 'cant', kind: 'angle', step: 0.5 },
    FIN_CROSS_SECTION,
    FIN_ROTATION,
    FIN_FILLET,
    ...FIN_TABS,
  ],
  tubefinset: [
    { key: 'finCount', label: 'tubeCount', kind: 'count' },
    { key: 'length', label: 'length', kind: 'length' },
    {
      key: 'outerRadius',
      label: 'tubeDiameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'outerRadiusAuto', tip: 'autoRadius' },
    },
    TUBE_BORE,
    { key: 'thickness', label: 'thickness', kind: 'length' },
    FIN_ROTATION,
  ],
  innertube: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'diameter', kind: 'length', diameter: true },
    TUBE_BORE,
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'motorMount', label: 'motorMount', kind: 'bool', section: 'motor' },
    { key: 'motorOverhang', label: 'motorOverhang', kind: 'length', section: 'motor' },
    // `cluster` round-trips through .ork, and the 2D, aft and 3D views all draw
    // the tube at every cluster offset.
    {
      key: 'cluster',
      label: 'cluster',
      kind: 'select',
      options: CLUSTER_OPTIONS,
      optLabel: (o, t) =>
        o === 'single' ? t('cluster.single') : t('cluster.pattern', { name: o, n: clusterCount(o) }),
      section: 'motor',
    },
    // What the pattern is drawn at: the spacing between tubes, as a multiple of
    // the tube diameter, and the roll of the whole group.
    { key: 'clusterScale', label: 'clusterScale', kind: 'number', step: 0.1, section: 'motor' },
    // The same spacing as a distance between tube walls. The desktop has one
    // spinner and a Relative/Absolute switch over it; both rows are live here.
    {
      key: 'clusterSeparation',
      label: 'clusterSeparation',
      kind: 'derived',
      derived: 'clusterSeparation',
      section: 'motor',
    },
    { key: 'clusterRotation', label: 'clusterRotation', kind: 'angle', step: 15, section: 'motor' },
    ...RADIAL_PLACEMENT,
  ],
  tubecoupler: [
    { key: 'length', label: 'length', kind: 'length' },
    {
      key: 'outerRadius',
      label: 'diameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'outerRadiusAuto', tip: 'autoRadius' },
    },
    TUBE_BORE,
    { key: 'thickness', label: 'thickness', kind: 'length' },
    ...RADIAL_PLACEMENT,
  ],
  centeringring: [
    { key: 'length', label: 'thickness', kind: 'length' },
    {
      key: 'outerRadius',
      label: 'outerDiameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'outerRadiusAuto', tip: 'autoRadius' },
    },
    {
      key: 'innerRadius',
      label: 'innerDiameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'innerRadiusAuto', tip: 'autoRadius' },
    },
    ...LINE_INSTANCES,
    ...RADIAL_PLACEMENT,
  ],
  bulkhead: [
    { key: 'length', label: 'thickness', kind: 'length' },
    {
      key: 'outerRadius',
      label: 'diameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'outerRadiusAuto', tip: 'autoRadius' },
    },
    ...LINE_INSTANCES,
    ...RADIAL_PLACEMENT,
  ],
  engineblock: [
    { key: 'length', label: 'length', kind: 'length' },
    {
      key: 'outerRadius',
      label: 'diameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'outerRadiusAuto', tip: 'autoRadius' },
    },
    TUBE_BORE,
    { key: 'thickness', label: 'thickness', kind: 'length' },
    ...RADIAL_PLACEMENT,
  ],
  launchlug: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'diameter', kind: 'length', diameter: true },
    TUBE_BORE,
    // A lug's wall round-trips through `.ork` (importReaders.ts /
    // exportWriters.ts) and sizes its printed solid. With the diameter it sets
    // the bore, which is the one dimension of a lug that has to be right: the
    // rod has to fit through it.
    { key: 'thickness', label: 'thickness', kind: 'length' },
    { key: 'angleOffset', label: 'rotation', kind: 'angle', section: 'placement' },
    ...LINE_INSTANCES,
  ],
  railbutton: [
    { key: 'outerDiameter', label: 'outerDiameter', kind: 'length' },
    // The rest of the button. The file services carry these and the kernel
    // takes them, so a 1010 button sized by hand weighs what it should.
    { key: 'innerDiameter', label: 'innerDiameter', kind: 'length' },
    { key: 'height', label: 'height', kind: 'length' },
    { key: 'baseHeight', label: 'baseHeight', kind: 'length' },
    { key: 'flangeHeight', label: 'flangeHeight', kind: 'length' },
    { key: 'screwHeight', label: 'screwHeight', kind: 'length' },
    { key: 'angleOffset', label: 'rotation', kind: 'angle', section: 'placement' },
    ...LINE_INSTANCES,
  ],
  parachute: [
    { key: 'diameter', label: 'diameter', kind: 'length' },
    { key: 'cd', label: 'dragCoeff', kind: 'number', step: 0.05, auto: { flag: 'cdAuto', tip: 'autoComputed' } },
    { key: 'lineCount', label: 'lineCount', kind: 'count' },
    { key: 'lineLength', label: 'lineLength', kind: 'length', auto: { flag: 'lineLengthAuto', tip: 'autoComputed' } },
    ...DEPLOY_FIELDS,
    ...PACKED,
    ...RADIAL_PLACEMENT,
  ],
  streamer: [
    { key: 'stripLength', label: 'length', kind: 'length' },
    { key: 'stripWidth', label: 'width', kind: 'length' },
    // How much fabric, and how long and thin. Either one re-cuts the strip and
    // leaves the other where it is.
    { key: 'stripArea', label: 'stripArea', kind: 'derived', derived: 'stripArea' },
    { key: 'stripAspect', label: 'stripAspect', kind: 'derived', derived: 'stripAspect', step: 0.5 },
    { key: 'cd', label: 'dragCoeff', kind: 'number', step: 0.05, auto: { flag: 'cdAuto', tip: 'autoComputed' } },
    ...DEPLOY_FIELDS,
    ...PACKED,
    ...RADIAL_PLACEMENT,
  ],
  masscomponent: [
    { key: 'mass', label: 'mass', kind: 'mass' },
    // The other way to say the same thing, for when you know what the lump is
    // made of rather than what it weighs. Approximate: the volume it divides by
    // is the packed size, which is the room the part takes up, not the part.
    { key: 'massDensity', label: 'massDensity', kind: 'derived', derived: 'massDensity' },
    // What the lump is. No physics: OpenRocket uses it to name and picture the
    // part, and it round-trips through the file.
    {
      key: 'massComponentType',
      label: 'massComponentType',
      kind: 'select',
      options: MASS_COMPONENT_TYPES,
      optI18n: 'massComponentType',
    },
    ...PACKED,
    ...RADIAL_PLACEMENT,
  ],
  shockcord: [
    // The cord itself, which is the whole part.
    { key: 'cordLength', label: 'cordLength', kind: 'length', auto: { flag: 'cordLengthAuto', tip: 'autoComputed' } },
    ...PACKED,
    ...RADIAL_PLACEMENT,
  ],
  // External pods: assembly placement only (their own chain is edited as
  // children).
  podset: ASSEMBLY_FIELDS,
  // Parallel booster: assembly placement + the same separation trigger a
  // booster <stage> carries (when it lets go of the core).
  parallelstage: [...ASSEMBLY_FIELDS, ...SEPARATION_FIELDS],
};

/**
 * The same table with `required` filled in from `services/design/requiredComponent`,
 * which is also what the Run button and the run loop check. One list, so the
 * editor cannot mark a field the run path ignores, or the other way round.
 *
 * A field the kernel derives is never marked, even though it is required in the
 * sense that the part cannot work without one: leaving a centering ring's outer
 * radius blank means "the tube I sit in", which is a real answer and the one
 * OpenRocket writes as `auto`. A red asterisk there would demand a number the
 * design does not need, and the run path agrees: `badDimensions` skips the same
 * pairs.
 */
export const FIELDS: Record<string, Field[]> = Object.fromEntries(
  Object.entries(RAW_FIELDS).map(([type, fields]) => [
    type,
    [...fields, COMMENT].map((f) =>
      (REQUIRED_COMPONENT_FIELDS[type] ?? []).includes(f.key) && !(AUTO_COMPONENT_FIELDS[type] ?? []).includes(f.key)
        ? { ...f, required: true }
        : f,
    ),
  ]),
);
