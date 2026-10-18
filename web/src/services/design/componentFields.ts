import type { TFunction } from 'i18next';
import { REQUIRED_COMPONENT_FIELDS } from './requiredComponent';
import { CLUSTER_OPTIONS, clusterCount } from '../../tree/cluster';
import type { DerivedName } from './derivedFields';
import type { IgnitionEvent } from '../../engine/openRocketEngine';
import { KERNEL_DEPLOYMENT } from '../../tree/kernelDefaults';
import { RAIL_BUTTON_BOUNDS, RAIL_BUTTON_FALLBACK, RING_BOUNDS, type DimensionBounds } from './linkedDimensions';
import { num } from '../../tree/nodeProps';

/**
 * The component field table: which properties each component type exposes,
 * what kind each is, and which ones a zero makes nonsense of.
 *
 * This is domain data, not presentation. It encodes the OpenRocket component
 * vocabulary, the shape lists, the deploy and separation event vocabularies,
 * the unit kinds and the required-ness. It does not live in `PropertyPanel`:
 * services (`files/ork/importTags`) and tests import it directly, and it takes
 * its required list from `services/design/requiredComponent`, so a service
 * would otherwise be depending on a component module for the shape of its own
 * domain.
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
 * - `material` is how the part's surface is finished, beside the material
 *   picker, where the desktop's Material panel puts it.
 *
 * A field with no `section` is a dimension and renders in the main list.
 */
export type PanelSection =
  'placement' | 'finTab' | 'motor' | 'fillet' | 'shoulder' | 'foreShoulder' | 'aftShoulder' | 'material' | 'comment';

type FieldFlags = {
  /**
   * A zero here is a value the kernel cannot fly (`REQUIRED_COMPONENT_FIELDS`);
   * it does not mean the box can be empty.
   *
   * Unlike the launch conditions (where a cleared field has to be told apart
   * from a typed zero, because still air and sea level are real values), such a
   * field has no meaningful blank. Zero is the invalid state, so there is no
   * second state to model and the field keeps storing a number.
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
  /**
   * A length that may be negative, bounded on both sides by the part's own
   * axial length (a fin set's root chord). The fin tab offset is one: the
   * kernel takes any offset (FinSet.setTabOffset), and from the default middle
   * reference a tab ahead of the root's middle is a negative one.
   */
  signedWithinLength?: true;
  /**
   * A length that may be negative and has no bound either way: the kernel's
   * setter stores any value and the desktop spinner is unbounded. A trapezoid
   * fin's sweep is one (`TrapezoidFinSet.setSweep`; negative is a forward
   * sweep, which the Sweep angle row below it writes), and so is a motor
   * overhang (`BodyTube.setMotorOverhang`, `InnerTube.setMotorOverhang`;
   * negative seats the motor short of the tube's aft end).
   */
  signed?: true;
  /**
   * The range the kernel's setter holds this value in, from the rest of the
   * part, in the node's own units. See services/design/linkedDimensions.ts.
   */
  bounds?: DimensionBounds;
  /** What an absent key flies as, when that is not zero. */
  whenAbsent?: number;
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
// (ComponentFactory.deployEventOf). The .ork file spells them with the
// underscores removed (OpenRocketSaver.enumToXMLName); the .ork reader and
// writer map at that boundary. Apogee first: it is what a new part is created
// with and the most common single-deploy trigger. A device with no event flies
// the kernel's default, which the field names as its fallback. The
// per-configuration deployment override offers this same list, and both drop
// the lower-stage separation on a stage with none below it
// (fieldRange.fieldOptions).
export const DEPLOY_EVENTS = ['apogee', 'ejection', 'altitude', 'launch', 'lower_stage_separation', 'never'];

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

// Stage-separation triggers (SeparationEvent, OpenRocketEngine.separationEventOf)
// (when a stage lets go of the one above it). Ejection first: the desktop default
// and the low/mid-power norm (drop off on the upper stage's ejection charge).
// The per-configuration separation override offers this same list.
export const SEPARATION_EVENTS = [
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
  { key: 'tabOffset', label: 'tabOffset', kind: 'length', section: 'finTab', signedWithinLength: true },
  {
    key: 'tabOffsetMethod',
    label: 'tabOffsetMethod',
    kind: 'select',
    options: ['top', 'middle', 'bottom'],
    // Unset reads as the kernel's default (FinSet.tabOffsetMethod), which the
    // bridge also falls back to.
    fallback: 'middle',
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

/**
 * The surface finish of an external part, which sets the roughness the
 * kernel's skin-friction drag reads (`ExternalComponent.setFinish`). The
 * names are the ones the bridge accepts (`ComponentFactory.finishOf`), in
 * the order desktop's `Finish` enum lists them; a part with none flies
 * `normal` (regular paint), the enum's default. Where desktop's MaterialPanel
 * puts it: with the material.
 */
const FINISHES = [
  'rough',
  'roughunfinished',
  'unfinished',
  'normal',
  'smooth',
  'optimum',
  'polished',
  'finishpolished',
  'mirror',
];
const FINISH: Field = {
  key: 'finish',
  label: 'finish',
  kind: 'select',
  options: FINISHES,
  optI18n: 'finish',
  fallback: 'normal',
  section: 'material',
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

/**
 * One rail button length. Every one has a nonzero kernel default an absent key
 * flies as, and four are clamped against each other by the kernel's setters.
 */
const railButtonLength = (key: keyof typeof RAIL_BUTTON_FALLBACK): Field => ({
  key,
  label: key,
  kind: 'length',
  whenAbsent: RAIL_BUTTON_FALLBACK[key],
  ...(RAIL_BUTTON_BOUNDS[key] ? { bounds: RAIL_BUTTON_BOUNDS[key] } : {}),
});

const LENGTH: Field = { key: 'length', label: 'length', kind: 'length' };
const WALL: Field = { key: 'thickness', label: 'thickness', kind: 'length' };

/**
 * At most the larger of these radii, an absent one leaving the value unbounded.
 * Every wall and shoulder setter below clamps against radii the node stores.
 */
const atMostRadius = (...keys: string[]): DimensionBounds => ({
  max: (n) => Math.max(...keys.map((k) => num(n, k, Infinity))),
});

/**
 * A tube's wall, at most its outer radius: `ThicknessRingComponent.setThickness`,
 * `LaunchLug.setThickness` and `TubeFinSet.setThickness` clamp to it, and a body
 * tube's `SymmetricComponent.setThickness` clamps to `getMaxRadius()`, which on
 * a tube is the same radius.
 */
const TUBE_WALL_THICKNESS: Field = { ...WALL, bounds: atMostRadius('outerRadius') };

// Solid all the way through, with no bore. The desktop's Filled checkbox, and
// `<thickness>filled</thickness>` in the file. The wall row is dropped while it
// is on, the way the desktop grays it out.
const FILLED: Field = { key: 'filled', label: 'filled', kind: 'bool' };

// A tube's outside diameter, automatic when it follows the part it fits.
const OUTER_DIAMETER: Field = {
  key: 'outerRadius',
  label: 'diameter',
  kind: 'length',
  diameter: true,
  auto: { flag: 'outerRadiusAuto', tip: 'autoRadius' },
};

// A straight tube with a wall: length, outside, bore and wall, in that order.
const TUBE_WALL: Field[] = [LENGTH, OUTER_DIAMETER, TUBE_BORE, TUBE_WALL_THICKNESS];

/**
 * Every ignition event, on every mount, as desktop offers `IgnitionEvent.values()`
 * (IgnitionSelectionDialog, MotorConfig). The two stage-below triggers fire
 * from the stage under the mount's own, which a strap-on booster is as well as
 * an axial stage (AxialStage.getUpperStage), so the bottom axial stage can
 * light at its boosters' burnout. On a mount with nothing below, they never
 * fire and the motor stays unlit, as on "never", which is how a spare mount
 * is flown. The names are the kernel's (OpenRocketEngine.ignitionEventOf) in
 * the .ork's spelling.
 */
export const IGNITION_EVENTS: IgnitionEvent[] = ['automatic', 'launch', 'ejectioncharge', 'burnout', 'never'];

// The mount's own ignition is the desktop Motor tab's "Ignition at"
// (`MotorMount.getDefaultMotorConfig()`). It flies nothing itself: a motor put
// in the mount starts from it, a motor still on it follows a change to it
// (`followMountIgnition`), and a motor set to something else on the
// Configurations tab keeps its own.
const MOTOR_MOUNT: Field[] = [
  { key: 'motorMount', label: 'motorMount', kind: 'bool', section: 'motor' },
  { key: 'motorOverhang', label: 'motorOverhang', kind: 'length', section: 'motor', signed: true },
  {
    key: 'ignitionEvent',
    label: 'ignitionEvent',
    kind: 'select',
    options: IGNITION_EVENTS,
    optI18n: 'ignition',
    section: 'motor',
  },
  { key: 'ignitionDelay', label: 'ignitionDelay', kind: 'number', unit: 's', step: 0.5, section: 'motor' },
];

// `rotation` is a fin set's base rotation: where its first fin sits around the
// body, with the rest spaced evenly from it. It round-trips through .ork
// (importTags.ts / exportParts.ts) and the 3D view places every fin and tube fin
// at it (rocketPieces.ts). The fin marking guide prints where each fin goes
// relative to the launch lug, and that relationship is this field.
const FIN_ROTATION: Field = { key: 'rotation', label: 'rotation', kind: 'angle', step: 5, section: 'placement' };

// What every planar fin set has after its outline: the fin's wall, cant and
// section, where the set sits, the root fillet and the tab.
const PLANAR_FIN: Field[] = [
  WALL,
  { key: 'cant', label: 'cant', kind: 'angle', step: 0.5 },
  FIN_CROSS_SECTION,
  FIN_ROTATION,
  FIN_FILLET,
  ...FIN_TABS,
];

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
 * `PropertyPanel.test.tsx` checks (through {@link FIELDS}) that no two
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
    FILLED,
    // SymmetricComponent.setThickness: at most getMaxRadius(), the base.
    { ...WALL, bounds: atMostRadius('aftRadius') },
    // A flipped nose cone is a tail cone: the same part turned round.
    { key: 'flipped', label: 'flipped', kind: 'bool' },
    { key: 'shoulderLength', label: 'shoulderLength', kind: 'length', section: 'shoulder' },
    {
      key: 'shoulderRadius',
      label: 'shoulderDiameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'shoulderAuto', tip: 'autoShoulder' },
      // NoseCone.setShoulderRadius: at most the base it plugs in behind.
      bounds: atMostRadius('aftRadius'),
      section: 'shoulder',
    },
    { key: 'shoulderThickness', label: 'shoulderThickness', kind: 'length', section: 'shoulder' },
    { key: 'shoulderCapped', label: 'shoulderCapped', kind: 'bool', section: 'shoulder' },
    FINISH,
  ],
  bodytube: [LENGTH, OUTER_DIAMETER, TUBE_BORE, FILLED, TUBE_WALL_THICKNESS, ...MOTOR_MOUNT, FINISH],
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
    FILLED,
    // SymmetricComponent.setThickness: at most getMaxRadius(), the wider end.
    { ...WALL, bounds: atMostRadius('foreRadius', 'aftRadius') },
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
      // Transition.setForeShoulderRadius: at most the fore radius.
      bounds: atMostRadius('foreRadius'),
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
      // Transition.setAftShoulderRadius: at most the aft radius.
      bounds: atMostRadius('aftRadius'),
      section: 'aftShoulder',
    },
    { key: 'aftShoulderThickness', label: 'aftShoulderThickness', kind: 'length', section: 'aftShoulder' },
    { key: 'aftShoulderCapped', label: 'aftShoulderCapped', kind: 'bool', section: 'aftShoulder' },
    FINISH,
  ],
  trapezoidfinset: [
    { key: 'finCount', label: 'finCount', kind: 'count' },
    { key: 'rootChord', label: 'rootChord', kind: 'length' },
    { key: 'tipChord', label: 'tipChord', kind: 'length' },
    { key: 'sweep', label: 'sweep', kind: 'length', signed: true },
    // The same sweep, as a plan does it. Signed: negative is a forward sweep.
    { key: 'sweepAngle', label: 'sweepAngle', kind: 'derived', derived: 'sweepAngle', step: 5 },
    { key: 'height', label: 'height', kind: 'length' },
    ...PLANAR_FIN,
    FINISH,
  ],
  ellipticalfinset: [
    { key: 'finCount', label: 'finCount', kind: 'count' },
    { key: 'rootChord', label: 'rootChord', kind: 'length' },
    { key: 'height', label: 'height', kind: 'length' },
    ...PLANAR_FIN,
    FINISH,
  ],
  freeformfinset: [{ key: 'finCount', label: 'finCount', kind: 'count' }, ...PLANAR_FIN, FINISH],
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
    TUBE_WALL_THICKNESS,
    FIN_ROTATION,
    FINISH,
  ],
  innertube: [
    LENGTH,
    { key: 'outerRadius', label: 'diameter', kind: 'length', diameter: true },
    TUBE_BORE,
    TUBE_WALL_THICKNESS,
    ...MOTOR_MOUNT,
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
    // Absent, the bridge flies a scale of 1 (ComponentFactory, case "innertube").
    { key: 'clusterScale', label: 'clusterScale', kind: 'number', step: 0.1, section: 'motor', whenAbsent: 1 },
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
  tubecoupler: [...TUBE_WALL, ...RADIAL_PLACEMENT],
  centeringring: [
    { key: 'length', label: 'thickness', kind: 'length' },
    {
      key: 'outerRadius',
      label: 'outerDiameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'outerRadiusAuto', tip: 'autoRadius' },
      bounds: RING_BOUNDS.outerRadius,
    },
    {
      key: 'innerRadius',
      label: 'innerDiameter',
      kind: 'length',
      diameter: true,
      auto: { flag: 'innerRadiusAuto', tip: 'autoRadius' },
      bounds: RING_BOUNDS.innerRadius,
    },
    ...LINE_INSTANCES,
    ...RADIAL_PLACEMENT,
  ],
  bulkhead: [
    { key: 'length', label: 'thickness', kind: 'length' },
    OUTER_DIAMETER,
    ...LINE_INSTANCES,
    ...RADIAL_PLACEMENT,
  ],
  engineblock: [...TUBE_WALL, ...RADIAL_PLACEMENT],
  launchlug: [
    { key: 'length', label: 'length', kind: 'length' },
    { key: 'outerRadius', label: 'diameter', kind: 'length', diameter: true },
    TUBE_BORE,
    // A lug's wall round-trips through `.ork` (importReaders.ts /
    // exportWriters.ts) and sizes its printed solid. With the diameter it sets
    // the bore, which is the one dimension of a lug that has to be right: the
    // rod has to fit through it.
    TUBE_WALL_THICKNESS,
    { key: 'angleOffset', label: 'rotation', kind: 'angle', section: 'placement' },
    ...LINE_INSTANCES,
    FINISH,
  ],
  railbutton: [
    railButtonLength('outerDiameter'),
    // The rest of the button. The file services carry these and the kernel
    // takes them, so a 1010 button sized by hand weighs what it should.
    railButtonLength('innerDiameter'),
    railButtonLength('height'),
    railButtonLength('baseHeight'),
    railButtonLength('flangeHeight'),
    railButtonLength('screwHeight'),
    { key: 'angleOffset', label: 'rotation', kind: 'angle', section: 'placement' },
    ...LINE_INSTANCES,
    FINISH,
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
 */
export const FIELDS: Record<string, Field[]> = Object.fromEntries(
  Object.entries(RAW_FIELDS).map(([type, fields]) => [
    type,
    [...fields, COMMENT].map((f) =>
      (REQUIRED_COMPONENT_FIELDS[type] ?? []).includes(f.key) ? { ...f, required: true } : f,
    ),
  ]),
);
