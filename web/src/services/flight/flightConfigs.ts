/**
 * Flight configurations: the named motor loadouts a simulation flies.
 *
 * OpenRocket's own model. A configuration holds one motor per motor mount (plus
 * that motor's ignition override), and a simulation names the configuration it
 * flies rather than carrying its own copy of the loadout. Several simulations
 * can therefore fly one setup, and "the same airframe on a C6 and on a D12" is
 * two configurations rather than two piles of duplicated motors.
 *
 * Every mount is keyed the same way, including the first one. There is no
 * primary-mount special case here: the builder, the drawing, the exporters and
 * the run gate all read one map, so none of them can disagree about which motor
 * is seated where.
 *
 * Recovery deployment, stage separation and stage activeness are
 * per-configuration too (`deployments`, `separations`, `grounded`): the design
 * tree holds the default for each device and each booster, and a configuration
 * may override when that device opens, when that stage lets go, and whether it
 * flies at all.
 */
import { C6 } from '../../engine/api';
import { findMounts, findRecoveryDevices, findSeparators, findStages, updateNode } from '../design/treeEdit';
import { uuid } from '../app/uuid';
import type { ComponentNode, IgnitionEvent, MotorSpec, RocketTree } from '../../engine/openRocketEngine';
import { KERNEL_DEPLOYMENT, KERNEL_SEPARATION } from '../../tree/kernelDefaults';
import { motorName } from '../motors/motorName';

/** One mount's cell: the motor seated in it, and when that motor ignites. */
export interface MountMotor {
  spec: MotorSpec;
  /** Undefined = automatic, which is the engine's own default and needs no call. */
  ignitionEvent?: IgnitionEvent;
  /** Seconds after the ignition event (default 0). */
  ignitionDelay?: number;
}

export interface FlightConfig {
  /**
   * Stable id. A configuration imported from a `.ork` keeps the file's
   * `configid`, so a round trip through this app is identity rather than a
   * rewrite.
   */
  id: string;
  /**
   * Null means unnamed, which the desktop renders as the configuration's motor
   * list. An unnamed configuration is not a broken one: it is how OpenRocket
   * writes a setup nobody bothered to name, and both ends have to round-trip it.
   */
  name: string | null;
  /** Motor per mount id. A mount with no entry is loaded with a default. */
  motors: Record<string, MountMotor>;
  /**
   * When each recovery device opens under THIS configuration, keyed by device
   * node id. Absent, or absent for one device, means the device's own values on
   * the design tree - which is how every device starts.
   *
   * An override is per FIELD: a configuration can move the altitude and leave
   * the event alone, which is what the file format expresses and what "deploy
   * the main at 150 m instead of 120 m on this flight" means.
   */
  deployments?: Record<string, DeployOverride>;
  /**
   * When each booster lets go under THIS configuration, keyed by stage node id.
   * Absent means the stage's own values on the design.
   *
   * Per field, like the deployments above: a configuration can add a delay and
   * leave the trigger where the design put it.
   */
  separations?: Record<string, SepOverride>;
  /**
   * The stages this configuration leaves on the ground, by stage node id.
   *
   * A LIST of the exceptions rather than a flag per stage: every stage flies
   * unless something says otherwise, so a configuration that grounds nothing
   * carries nothing, and a stage added later is in the flight without having to
   * be added here too.
   */
  grounded?: string[];
}

/** One stage's separation, as one configuration overrides it. */
export interface SepOverride {
  separationEvent?: string;
  separationDelay?: number;
  separationAltitude?: number;
}

/** One recovery device's deployment, as one configuration overrides it. */
export interface DeployOverride {
  deployEvent?: string;
  deployAltitude?: number;
  deployDelay?: number;
}

const designString = (node: ComponentNode, key: string, fallback: string): string => {
  const v = node[key];
  return typeof v === 'string' && v ? v : fallback;
};
const designNumber = (node: ComponentNode, key: string, fallback: number): number => {
  const v = node[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

/** A recovery device's deployment as the design states it, kernel defaults filling the gaps. */
export function designDeployment(device: ComponentNode): Required<DeployOverride> {
  return {
    deployEvent: designString(device, 'deployEvent', KERNEL_DEPLOYMENT.deployEvent),
    deployAltitude: designNumber(device, 'deployAltitude', KERNEL_DEPLOYMENT.deployAltitude),
    deployDelay: designNumber(device, 'deployDelay', KERNEL_DEPLOYMENT.deployDelay),
  };
}

/** A stage's separation as the design states it, kernel defaults filling the gaps. */
export function designSeparation(stage: ComponentNode): Required<SepOverride> {
  return {
    separationEvent: designString(stage, 'separationEvent', KERNEL_SEPARATION.separationEvent),
    separationAltitude: designNumber(stage, 'separationAltitude', KERNEL_SEPARATION.separationAltitude),
    separationDelay: designNumber(stage, 'separationDelay', KERNEL_SEPARATION.separationDelay),
  };
}

/** What a device does under one configuration: its override over the design. */
export function effectiveDeployment(config: FlightConfig, device: ComponentNode): Required<DeployOverride> {
  return { ...designDeployment(device), ...deployOverride(config, device.id as string) };
}

/** What a stage does under one configuration: its override over the design. */
export function effectiveSeparation(config: FlightConfig, stage: ComponentNode): Required<SepOverride> {
  return { ...designSeparation(stage), ...sepOverride(config, stage.id as string) };
}

export function newFlightConfig(
  motors: Record<string, MountMotor> = {},
  name: string | null = null,
  id: string = uuid(),
): FlightConfig {
  return { id, name, motors };
}

/**
 * The configuration a simulation flies, falling back to the first.
 *
 * The same fallback `selectActive` gives a stale active-simulation id: a
 * workspace whose `configId` names nothing must still fly something rather than
 * leaving the app with no motors and no way to pick one.
 */
export function configFor(configs: readonly FlightConfig[], configId: string): FlightConfig {
  return configs.find((c) => c.id === configId) ?? configs[0]!;
}

/**
 * Every LIVE mount paired with its motor, in tree order.
 *
 * Tree order rather than object-key order, and mounts rather than map entries,
 * so this is the one answer to "what does this configuration seat where":
 * a mount that no longer exists (or is no longer flagged as a mount) drops out,
 * and the seating order is a property of the design rather than of the order
 * somebody happened to edit the motors in.
 */
export function liveMotors(tree: RocketTree, config: FlightConfig): [string, MountMotor][] {
  const out: [string, MountMotor][] = [];
  for (const m of findMounts(tree)) {
    const id = m.id as string;
    const seated = config.motors[id];
    if (seated) out.push([id, seated]);
  }
  return out;
}

/**
 * The motor whose absence blocks a flight: the first mount in tree order.
 *
 * One mount has to carry a usable motor for a run to mean anything, and it is
 * the first one, the way the run gate has always judged it. An upper stage left
 * empty is a design decision; a rocket with nothing in its aft mount is not a
 * flight.
 */
export function primaryMotor(tree: RocketTree, config: FlightConfig): MotorSpec | undefined {
  return liveMotors(tree, config)[0]?.[1].spec;
}

/** Every seated motor's spec, in tree order (mass totals, report rows). */
export function motorSpecs(tree: RocketTree, config: FlightConfig): MotorSpec[] {
  return liveMotors(tree, config).map(([, m]) => m.spec);
}

/**
 * Re-key one configuration against the rocket's mounts.
 *
 * Drops entries whose mount is gone (a stale entry would linger in the file and
 * misrender), and seeds a default C6 into a mount with no motor at all, so every
 * mount is loaded and a fresh mount does not silently block the run.
 *
 * A mount the entry says is EMPTY keeps that entry. An imported `.ork` seats a
 * curve-less placeholder in a mount the file left empty (`loadOrk`), and the
 * policy for a file is that a mount flies only what the file put in it: seeding
 * a C6 over the placeholder would fly a motor the file never named.
 *
 * Returns the SAME object when nothing moved, so a plain dimension edit
 * allocates nothing and the autosave does not see a change that isn't one.
 */
export function reconcileConfig(tree: RocketTree, config: FlightConfig): FlightConfig {
  const ids = findMounts(tree).map((m) => m.id as string);
  const present = new Set(ids);
  let changed = false;
  const next: Record<string, MountMotor> = {};
  for (const [id, m] of Object.entries(config.motors)) {
    if (present.has(id)) next[id] = m;
    else changed = true;
  }
  for (const id of ids) {
    if (!next[id]) {
      next[id] = { spec: C6 };
      changed = true;
    }
  }
  // Deployment overrides go the same way as motors: a device that has been
  // deleted takes its override with it, rather than leaving an entry that a
  // later device reusing the id would inherit.
  const devices = new Set(findRecoveryDevices(tree).map((d) => d.id as string));
  let deployments = config.deployments;
  if (deployments && Object.keys(deployments).some((id) => !devices.has(id))) {
    deployments = Object.fromEntries(Object.entries(deployments).filter(([id]) => devices.has(id)));
    changed = true;
  }
  const separators = new Set(findSeparators(tree).map((n) => n.id as string));
  let separations = config.separations;
  if (separations && Object.keys(separations).some((id) => !separators.has(id))) {
    separations = Object.fromEntries(Object.entries(separations).filter(([id]) => separators.has(id)));
    changed = true;
  }
  const stages = new Set(findStages(tree).map((n) => n.id as string));
  let grounded = config.grounded;
  if (grounded?.some((id) => !stages.has(id))) {
    grounded = grounded.filter((id) => stages.has(id));
    changed = true;
  }
  return changed
    ? {
        ...config,
        motors: next,
        ...(deployments ? { deployments } : {}),
        ...(separations ? { separations } : {}),
        ...(grounded ? { grounded } : {}),
      }
    : config;
}

/** {@link reconcileConfig} over every configuration, preserving identity. */
export function reconcileConfigs(tree: RocketTree, configs: FlightConfig[]): FlightConfig[] {
  let changed = false;
  const next = configs.map((c) => {
    const r = reconcileConfig(tree, c);
    if (r !== c) changed = true;
    return r;
  });
  return changed ? next : configs;
}

/**
 * What a configuration is CALLED when nobody has named it: its motor list, aft
 * to nose.
 *
 * The desktop's own rule. An unnamed configuration is the normal case - every
 * one this app mints is unnamed, and so is every one a `.ork` writes for a setup
 * the user never titled - so a blank would leave a list of rows nobody could
 * tell apart, while the motors say exactly what the row flies.
 *
 * Empty when nothing is seated. The caller says what to print then, because "no
 * motors" is a sentence in the reader's language rather than a name.
 */
export function loadoutLabel(tree: RocketTree, config: FlightConfig): string {
  return motorSpecs(tree, config)
    .filter((m) => m.designation)
    .map((m) => (m.manufacturer ? `${m.manufacturer} ${motorName(m)}` : motorName(m)))
    .join(' + ');
}

/** The deployment fields a configuration overrides for one device, if any. */
export function deployOverride(config: FlightConfig, deviceId: string): DeployOverride | undefined {
  const o = config.deployments?.[deviceId];
  return o && Object.keys(o).length ? o : undefined;
}

/** Whether this configuration flies that stage (every stage, unless grounded). */
export function stageFlies(config: FlightConfig, stageId: string): boolean {
  return !config.grounded?.includes(stageId);
}

/** The separation fields a configuration overrides for one stage, if any. */
export function sepOverride(config: FlightConfig, stageId: string): SepOverride | undefined {
  const o = config.separations?.[stageId];
  return o && Object.keys(o).length ? o : undefined;
}

/**
 * The tree as THIS configuration flies it: each overridden recovery device and
 * booster carrying that configuration's own values.
 *
 * Applied to the tree rather than to the built rocket because deployment and
 * separation are already node inputs the kernel reads at build time, so one
 * configuration's flight is the same build path as any other - no second way to
 * seat a value, and the worker gets it by building the configuration it was
 * handed.
 *
 * Returns the SAME tree when nothing is overridden, which is the common case and
 * what keeps the rebuild effect's keys and the memo chains from seeing a change
 * that isn't one.
 */
export function configuredTree(tree: RocketTree, config: FlightConfig): RocketTree {
  let out = tree;
  for (const [deviceId, o] of Object.entries(config.deployments ?? {})) {
    out = patchNode(out, deviceId, o, ['deployEvent', 'deployAltitude', 'deployDelay']);
  }
  for (const [stageId, o] of Object.entries(config.separations ?? {})) {
    out = patchNode(out, stageId, o, ['separationEvent', 'separationDelay', 'separationAltitude']);
  }
  return out;
}

/**
 * Write the keys an override actually declares onto one node.
 *
 * Only the declared ones: an override is per field, and an `undefined` written
 * over the design's own value would blank it rather than leave it alone. A node
 * that is no longer in the tree patches nothing (`updateNode` returns an equal
 * tree) and its stale entry is dropped by `reconcileConfig`.
 */
function patchNode<T extends object>(tree: RocketTree, id: string, over: T, keys: readonly (keyof T & string)[]) {
  const patch: Partial<ComponentNode> = {};
  for (const key of keys) if (over[key] !== undefined) patch[key] = over[key] as ComponentNode[string];
  return Object.keys(patch).length ? updateNode(tree, id, patch) : tree;
}

/**
 * Serial numbers for spec OBJECTS, so a key can carry reference identity.
 *
 * A WeakMap, so a spec that goes out of scope takes its number with it.
 */
const specSerials = new WeakMap<object, number>();
let nextSerial = 1;
function serialOf(spec: object): number {
  let n = specSerials.get(spec);
  if (n === undefined) {
    n = nextSerial++;
    specSerials.set(spec, n);
  }
  return n;
}

/**
 * A key over the MOTORS a configuration seats, and nothing else.
 *
 * The engine rebuild is keyed on this rather than on the configuration object.
 * Ignition timing cannot move mass, CG, CP, static margin or Cd - `staticInfo()`
 * and `aeroSweep()` are geometry plus loaded-motor properties - and the ignition
 * delay field is a raw number input with a per-keystroke onChange, so depending
 * on the whole configuration runs a full build + static read + drag sweep on the
 * main thread for every character typed.
 *
 * Reference-exact, via a per-spec serial: a new spec object is a new key. That is
 * the safe direction to be wrong in, since a needless rebuild costs milliseconds
 * and a missed one leaves the readouts describing a motor that is not seated.
 */
export function seatedMotorsKey(tree: RocketTree, config: FlightConfig): string {
  return liveMotors(tree, config)
    .map(([id, m]) => `${id}:${serialOf(m.spec)}`)
    .join('|');
}

/**
 * What makes two loadouts the same flight.
 *
 * Mount ids with the motor's identity (manufacturer, designation, delay) and its
 * ignition, sorted so key order cannot make two identical loadouts look
 * different. Not the thrust samples: two catalog fetches of one motor are the
 * same motor, and comparing curves would split them.
 */
export function loadoutSignature(motors: Record<string, MountMotor>): string {
  return Object.keys(motors)
    .sort()
    .map((id) => {
      const m = motors[id]!;
      const s = m.spec;
      return [
        id,
        s.manufacturer ?? '',
        s.designation,
        s.ejectionDelay,
        s.diameter,
        s.length,
        m.ignitionEvent ?? '',
        m.ignitionDelay ?? 0,
      ].join('');
    })
    .join('');
}

/**
 * The configuration holding this loadout, creating one if none does.
 *
 * So a new simulation joins the configuration it would have duplicated instead
 * of minting a second identical one. Two configurations that seat the same
 * motors in the same mounts are the same flight, and a list full of
 * indistinguishable rows is a list nobody can choose from.
 */
export function ensureConfig(
  configs: FlightConfig[],
  motors: Record<string, MountMotor>,
): { configs: FlightConfig[]; id: string } {
  const sig = loadoutSignature(motors);
  const found = configs.find((c) => loadoutSignature(c.motors) === sig);
  if (found) return { configs, id: found.id };
  const made = newFlightConfig(motors);
  return { configs: [...configs, made], id: made.id };
}
