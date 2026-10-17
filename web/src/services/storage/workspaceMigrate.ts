/**
 * Reading a persisted workspace: shape-check it, and lift an older one to the
 * current version.
 *
 * Every path that reads stored bytes goes through {@link migrateWorkspace} -
 * boot, the unload journal, and File > Open - so nothing downstream ever sees an
 * older shape, and the upgrade is written once rather than per reader.
 *
 * Version 1 kept each simulation's motor loadout inline: `motor` for the first
 * mount, `extraMotors` for the rest, ignition fields alongside. Version 2 holds
 * those as named flight configurations the simulations point at
 * (services/flight/flightConfigs.ts). Version 3 holds a deployment or
 * separation override only where a configuration has one of its own, as
 * desktop's FlightConfigurableParameterSet does: a version 2 workspace can
 * carry one for every configuration and every part, each repeating the part's
 * values (see {@link withoutRepeated}).
 */
import { findMounts } from '../design/treeEdit';
import { settleLinkedDimensions } from '../design/linkedDimensions';
import {
  loadoutSignature,
  newFlightConfig,
  withoutRepeatedOverrides,
  type FlightConfig,
  type MountMotor,
} from '../flight/flightConfigs';
import { rekeyedForConfig, type Simulation } from '../flight/simulations';
import type { Workspace } from './workspaceStore';
import type { IgnitionEvent, MotorSpec } from '../../engine/openRocketEngine';
import { C6 } from '../../engine/api';

/** One version-1 simulation: the loadout inline, the first mount apart from the rest. */
interface SimulationV1 extends Omit<Simulation, 'configId'> {
  motor?: MotorSpec;
  extraMotors?: Record<string, MountMotor>;
  ignitionEvent?: IgnitionEvent;
  ignitionDelay?: number;
}

/** Version 2: the current shape, with repeated overrides possibly still in it. */
interface WorkspaceV2 extends Omit<Workspace, 'version'> {
  version: 2;
}

interface WorkspaceV1 extends Omit<Workspace, 'version' | 'sims' | 'configs'> {
  version: 1;
  sims: SimulationV1[];
  /** Older still: one loadout for the whole workspace, applied to every sim. */
  extraMotors?: Record<string, MountMotor>;
}

/**
 * Accept a stored workspace, upgraded to the current version, or null.
 *
 * Null covers a truncated or hand-edited blob, and a version this build does not
 * know: `tree.components` that is not an array would crash `buildTree` deep in
 * the kernel rather than fail cleanly here, and a workspace written by a newer
 * build (an installed PWA can have an older one cached) must be refused rather
 * than half-read. The caller decides what a refusal means - the boot path
 * detaches rather than overwriting the design it could not read.
 *
 * The elements are checked too, not just the arrays: a `null` simulation,
 * configuration or component passes an array check and then throws in the
 * readers that dereference every entry (re-attaching flights, `hydrate`), after
 * the boot path has already taken its claim on the stored design.
 */
export function migrateWorkspace(w: unknown): Workspace | null {
  const c = w as Partial<Workspace> | Partial<WorkspaceV2> | Partial<WorkspaceV1> | null;
  if (
    !c ||
    !isRecord(c.tree) ||
    !isComponentList((c.tree as { components?: unknown }).components) ||
    !Array.isArray(c.sims) ||
    c.sims.length === 0 ||
    !c.sims.every(hasStringId)
  ) {
    return null;
  }
  if (c.version === 3 || c.version === 2) {
    const held = c as Workspace | WorkspaceV2;
    // From v2 on every simulation's motors live in `configs`, so a blob
    // without one is not a v2 or v3 workspace.
    if (!Array.isArray(held.configs) || held.configs.length === 0 || !held.configs.every(hasStringId)) return null;
    return settled(held.version === 2 ? withoutRepeated(held) : held);
  }
  if (c.version === 1) return settled(withoutRepeated(fromV1(c as WorkspaceV1)));
  return null;
}

/**
 * Version 2 to 3: drop the deployment and separation overrides that only
 * repeat their part's values.
 *
 * A version 2 workspace can come from an import that recorded every
 * configuration's recovery and staging as an override, the file's bare values
 * included. Kept, each pins its configuration to the part's value as it was,
 * and a Design-tab edit to the part no longer reaches that flight. Desktop
 * keeps an override only for a configuration whose block it read, so dropped,
 * the configuration follows the part as it does there.
 *
 * Once only: from version 3 on, an override equal to the part's value is one
 * the configuration holds on purpose, as a desktop file's block can be, and it
 * keeps its value when the part's changes.
 *
 * Each pruned override flies the same as none, so a result or file summary
 * current against the stored configuration is rekeyed to stay current.
 */
function withoutRepeated(w: WorkspaceV2): Workspace {
  const configs = withoutRepeatedOverrides(w.tree, w.configs);
  if (configs === w.configs) return { ...w, version: 3 };
  const before = new Map(w.configs.map((c) => [c.id, c]));
  const after = new Map(configs.map((c) => [c.id, c]));
  const sims = w.sims.map((s) => {
    const was = before.get(s.configId);
    const now = after.get(s.configId);
    if (!was || !now || was === now) return s;
    const key = s.resultKey == null ? null : rekeyedForConfig(s.resultKey, was, now);
    const summaryKey = s.fileSummary?.key == null ? null : rekeyedForConfig(s.fileSummary.key, was, now);
    return {
      ...s,
      ...(key !== null ? { resultKey: key } : {}),
      ...(summaryKey !== null ? { fileSummary: { ...s.fileSummary!, key: summaryKey } } : {}),
    };
  });
  return { ...w, version: 3, configs, sims };
}

/**
 * The workspace with its rail buttons and centering rings held as the kernel
 * builds them, so the panel shows what flies, and with the built-in C6 curve
 * current (see {@link currentBuiltInC6}). A workspace with nothing to change
 * comes back as the same object.
 */
function settled(w: Workspace): Workspace {
  const tree = settleLinkedDimensions(w.tree);
  const configs = currentBuiltInC6(w.configs);
  return tree === w.tree && configs === w.configs ? w : { ...w, tree, configs };
}

/**
 * A placeholder curve stored designs can carry as their built-in C6. It is not
 * the Estes C6 the catalog lists, and it delivers more impulse than that motor.
 */
const PLACEHOLDER_C6 = { times: [0, 0.2, 0.4, 2.0, 2.1], thrusts: [0, 12, 5, 5, 0] };

const sameNumbers = (a: unknown, b: readonly number[]): boolean =>
  Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Every seated motor that is that placeholder curve, given the current
 * built-in C6's curve and weights instead.
 *
 * A seated spec is stored whole, so a design saved while the placeholder was
 * the default keeps flying it until the motor is picked again. Only this exact
 * curve is replaced: it never came from the catalog or a file, so it is the
 * built-in motor and nothing the user chose. The delay is kept, since the
 * picker can change it on a seated motor. The maker is set as well: a stored
 * placeholder can carry none, and a C6 with no maker is a name several makers
 * sell, so a save could not say which one it is.
 */
function currentBuiltInC6(configs: FlightConfig[]): FlightConfig[] {
  let changed = false;
  const next = configs.map((c) => {
    if (!c.motors || typeof c.motors !== 'object') return c;
    let motors: Record<string, MountMotor> | null = null;
    for (const [id, m] of Object.entries(c.motors)) {
      const spec = m?.spec;
      if (
        !spec ||
        spec.designation !== 'C6' ||
        !sameNumbers(spec.times, PLACEHOLDER_C6.times) ||
        !sameNumbers(spec.thrusts, PLACEHOLDER_C6.thrusts)
      ) {
        continue;
      }
      motors ??= { ...c.motors };
      motors[id] = {
        ...m,
        spec: {
          ...spec,
          manufacturer: C6.manufacturer,
          times: [...C6.times],
          thrusts: [...C6.thrusts],
          masses: [...C6.masses],
        },
      };
    }
    if (!motors) return c;
    changed = true;
    return { ...c, motors };
  });
  return changed ? next : configs;
}

/** A plain object, not null and not an array. */
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A simulation or configuration: an object carrying its id. */
const hasStringId = (v: unknown): boolean => isRecord(v) && typeof v.id === 'string';

/** Components are objects, and a component's `children`, when present, are components too. */
function isComponentList(v: unknown): boolean {
  return Array.isArray(v) && v.every((n) => isRecord(n) && (n.children === undefined || isComponentList(n.children)));
}

/**
 * Version 1 to 2: mint a configuration per distinct loadout.
 *
 * Deduped, because two rows that seated the same motors in the same mounts were
 * already flying the same configuration - one row per copy would open the
 * configurations list full of rows nobody could tell apart. Rows that differ
 * below the first mount (the reason the loadout moved onto each simulation in
 * the first place) still get a configuration each, so what the workspace flew is
 * unchanged.
 *
 * Every configuration is unnamed, which the desktop renders as its motor list.
 * Naming them would be inventing a name the user never typed.
 */
function fromV1(w: WorkspaceV1): WorkspaceV2 {
  const primaryId = findMounts(w.tree)[0]?.id;
  const configs: FlightConfig[] = [];
  const bySignature = new Map<string, FlightConfig>();
  const sims: Simulation[] = w.sims.map((s) => {
    // The oldest shape kept one map for the whole workspace, which applied to
    // every simulation; folding it in reproduces exactly what that workspace
    // flew. A simulation carrying its own map keeps it.
    const extras = s.extraMotors ?? w.extraMotors ?? {};
    const motors: Record<string, MountMotor> = {};
    for (const [id, m] of Object.entries(extras)) {
      // A v1 workspace could hold a lingering entry for the first mount (it was
      // kept on purpose, so a motor survived a mount stopping being primary).
      // Every v1 consumer skipped it, so the loadout it actually flew skips it.
      if (id !== primaryId) motors[id] = m;
    }
    if (primaryId && s.motor) {
      motors[primaryId] = {
        spec: s.motor,
        ...(s.ignitionEvent ? { ignitionEvent: s.ignitionEvent } : {}),
        ...(s.ignitionDelay != null ? { ignitionDelay: s.ignitionDelay } : {}),
      };
    }
    const sig = loadoutSignature(motors);
    let config = bySignature.get(sig);
    if (!config) {
      config = newFlightConfig(motors);
      bySignature.set(sig, config);
      configs.push(config);
    }
    const { motor: _motor, extraMotors: _extras, ignitionEvent: _ev, ignitionDelay: _delay, ...rest } = s;
    return { ...rest, configId: config.id };
  });
  // A workspace with no mounts at all still needs one configuration to point at.
  if (!configs.length) {
    const empty = newFlightConfig();
    configs.push(empty);
    for (const s of sims) s.configId = empty.id;
  }
  return { version: 2, tree: w.tree, sims, configs, activeId: w.activeId, loadedMeta: w.loadedMeta };
}
