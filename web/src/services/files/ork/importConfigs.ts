import { PLUGGED_DELAY, type ComponentNode } from '../../../engine/openRocketEngine';
import { xmlText as text } from '../xmlUtil';
import type { OrkMotorRef, OrkFlightConfig } from '../orkTypes';
import { nonNegTag, numTag, readDeploymentTags, readSeparationTags } from './importTags';
import { MAX_MOTOR_CONFIGS } from './importLimits';
import { finiteNum } from './numbers';
import { keyedNote, notePartName, type ImportNote } from '../importNote';
import { KeyedError } from '../../../i18n/keyedError';
import { IGNITION_EVENTS } from '../../design/componentFields';

/**
 * Flight configurations on the way in: the rocket-level declaration table,
 * which one the import applies, and the per-component reads that depend on it
 * (a mount's motors and ignition, a recovery device's deployment overrides).
 */

/** What every reader shares for one import: the config table and the result's accumulators. */
export interface OrkImportContext {
  configs: OrkFlightConfig[];
  chosenConfigId: string | null;
  notes: ImportNote[];
  ignored: Set<string>;
  /** Every mount's motor for the chosen configuration, keyed by node id. */
  motors: Record<string, OrkMotorRef>;
  /** The first motor found. */
  motor: OrkMotorRef | undefined;
  /** Components read so far, against MAX_COMPONENTS. Mutable on purpose:
   *  the readers recurse, so the ceiling has to be one running total
   *  rather than a per-level one. */
  nodeCount: number;
}

/**
 * Flight-configuration table: rocket-level <motorconfiguration> blocks
 * (optional <name>, optional default="true"; desktop 24.12
 * MotorConfigurationHandler).
 * Capped like the archive itself. `captureDeployments` and `configScoped`
 * both scan a component's children once per config, so a ~500 KB file
 * declaring 20 000 configurations against a few thousand components makes
 * the import O(configs x children) on the main thread and freezes the tab.
 * A real design has a handful. A file past the cap is refused rather than
 * cut short, since a save would write it back without the rest.
 */
export function readFlightConfigs(rocketEl: Element): {
  configEls: Element[];
  configs: OrkFlightConfig[];
  chosenConfigId: string | null;
} {
  const configEls = Array.from(rocketEl.querySelectorAll(':scope > motorconfiguration'));
  if (configEls.length > MAX_MOTOR_CONFIGS) throw new KeyedError('errors.file.tooManyConfigs');
  // One configuration per id, as the desktop's createFlightConfiguration
  // returns the existing one for a repeated id: a later non-blank name
  // replaces the earlier one, and either block can mark it the default.
  const byId = new Map<string, OrkFlightConfig>();
  for (const c of configEls) {
    const id = c.getAttribute('configid') ?? '';
    if (id === '') continue;
    const name = text(c, ':scope > name');
    const isDefault = c.getAttribute('default') === 'true';
    const seen = byId.get(id);
    if (seen) {
      if (name?.trim()) seen.name = name;
      seen.isDefault ||= isDefault;
      continue;
    }
    byId.set(id, { id, name, isDefault, motors: {}, deployments: {}, separations: {}, grounded: [] });
  }
  const configs = [...byId.values()];
  const chosenConfigId = configs.find((c) => c.isDefault)?.id ?? configs[0]?.id ?? null;
  return { configEls, configs, chosenConfigId };
}

// The chosen configuration's child of `el` by tag name (per-config motor
// or override block). With no declared configs, the first such child:
// hand-rolled files may key <motor configid>s without declarations, and
// first-in-document-order is the read for them.
export function configScoped(ctx: OrkImportContext, el: Element, tag: string): Element | null {
  return ctx.chosenConfigId === null
    ? el.querySelector(`:scope > ${tag}`)
    : (Array.from(el.children).find((c) => c.tagName === tag && c.getAttribute('configid') === ctx.chosenConfigId) ??
        null);
}

/**
 * Record each configuration's <deploymentconfiguration> for this recovery
 * device, not just the chosen one. Export replays them so opening config A
 * and saving cannot rewrite config B's recovery settings (see
 * OrkFlightConfig.deployments).
 *
 * Only a configuration with a block of its own overrides anything. Desktop
 * writes the default bare and a block only for a configuration that differs
 * from it (RecoveryDeviceSaver.addParams), so a configuration with no block
 * recovers the way the design does and follows an edit to the design's value.
 * A block's value is the bare defaults with the block's fields over them, as
 * DeploymentConfigurationHandler clones the default before applying the block.
 * The same reader as the design's own, floors and event check included; the
 * bare tags are read without notes here, since the design's own read has
 * already noted anything wrong with them.
 */
export function captureDeployments(ctx: OrkImportContext, el: Element, node: ComponentNode): void {
  if (!node.id) return;
  for (const c of ctx.configs) {
    const block = Array.from(el.children).find(
      (x) => x.tagName === 'deploymentconfiguration' && x.getAttribute('configid') === c.id,
    );
    if (!block) continue;
    const o = { ...readDeploymentTags(el, node, undefined), ...readDeploymentTags(block, node, ctx.notes) };
    if (Object.keys(o).length > 0) c.deployments[node.id] = o;
  }
}

/**
 * Read each configuration's `<stage number="n" active="false"/>` flags into the
 * stages they name.
 *
 * Called once the tree is built, because the file addresses a stage by number
 * and everything downstream addresses it by node id: `stages` is the same walk
 * the numbering comes from (treeEdit.findStages), so position n is stage n. A
 * flag naming a stage the file does not have is dropped rather than guessed at.
 */
export function readStageActiveness(configEls: Element[], configs: OrkFlightConfig[], stageIds: string[]): void {
  for (const el of configEls) {
    const config = configs.find((c) => c.id === el.getAttribute('configid'));
    if (!config) continue;
    for (const flag of Array.from(el.querySelectorAll(':scope > stage'))) {
      if (flag.getAttribute('active') !== 'false') continue;
      // Through `finiteNum`, because `Number(null)` and `Number('')` are 0: a
      // `<stage active="false"/>` with no number attribute, or a blank one,
      // would otherwise read as stage 0 and ground the sustainer instead of
      // being dropped as the doc above says.
      const num = finiteNum(flag.getAttribute('number'));
      if (num === undefined) continue;
      const id = stageIds[num];
      if (id && !config.grounded.includes(id)) config.grounded.push(id);
    }
  }
}

/**
 * Record each configuration's <separationconfiguration> for this booster, the
 * way {@link captureDeployments} records its recovery: only a configuration
 * with a block of its own overrides the design's staging, and its value is the
 * bare defaults with the block's fields over them, as
 * StageSeparationConfigurationHandler clones the default before applying it.
 */
export function captureSeparations(ctx: OrkImportContext, el: Element, node: ComponentNode): void {
  if (!node.id) return;
  for (const c of ctx.configs) {
    const block = Array.from(el.children).find(
      (x) => x.tagName === 'separationconfiguration' && x.getAttribute('configid') === c.id,
    );
    if (!block) continue;
    const o = { ...readSeparationTags(el, node, undefined), ...readSeparationTags(block, node, ctx.notes) };
    if (Object.keys(o).length > 0) c.separations[node.id] = o;
  }
}

/**
 * A motor's ejection delay. Desktop's MotorHandler treats "none", an absent
 * <delay> and one it cannot parse alike: plugged, no ejection charge. A 0 s
 * fallback would fire the charge at burnout instead.
 */
function readDelay(motorEl: Element): number {
  const t = text(motorEl, ':scope > delay');
  if (t === null || t === 'none') return PLUGGED_DELAY;
  const v = Number(t.trim());
  return t.trim() !== '' && Number.isFinite(v) ? Math.max(0, v) : PLUGGED_DELAY;
}

/** A mount's <motormount>: the mount flag, its overhang, its own ignition, and every configuration's motor. */
export function readMotor(ctx: OrkImportContext, el: Element, node: ComponentNode): void {
  const mountEl = el.querySelector(':scope > motormount');
  if (!mountEl) return;
  // Any tube with a <motormount> is a mount: an inner tube, or a body tube
  // on a minimum-diameter rocket (kernel BodyTube implements MotorMount,
  // same as the desktop). The flag survives even with no motor loaded.
  node['motorMount'] = true;
  // Motor overhang (m): aft protrusion past the mount (min-diameter practice).
  const overhang = numTag(mountEl, 'overhang', 0);
  if (overhang !== 0) node['motorOverhang'] = overhang;
  // The mount's own ignition, the bare tags (RocketComponentSaver writes
  // `getDefaultMotorConfig()` there). Kept on the mount whether or not any
  // configuration has a motor in it; an event desktop does not know is dropped,
  // as MotorMountHandler drops it.
  const bareEvent = text(mountEl, ':scope > ignitionevent')?.trim();
  if (bareEvent && bareEvent !== 'automatic' && IGNITION_EVENTS.some((ev) => ev === bareEvent)) {
    node['ignitionEvent'] = bareEvent;
  }
  const bareDelay = nonNegTag(mountEl, 'ignitiondelay', 0);
  if (bareDelay !== 0) node['ignitionDelay'] = bareDelay;
  // One configuration's motor+ignition off this mount. Plugged motors (no
  // ejection charge): the desktop writes the literal string "none"
  // (Motor.PLUGGED_DELAY). Represent as the JSON-safe PLUGGED_DELAY sentinel,
  // which the engine maps to +Inf ("never fires") at the kernel boundary.
  // Ignition: the bare tags on <motormount> are the defaults, and a
  // configuration's <ignitionconfiguration> overrides them field by field.
  const ignitionEvent = (igEl: Element | undefined): string | undefined =>
    (igEl && text(igEl, ':scope > ignitionevent')) ?? text(mountEl, ':scope > ignitionevent') ?? undefined;
  const ignitionDelay = (igEl: Element | undefined): number =>
    nonNegTag(igEl && text(igEl, ':scope > ignitiondelay') !== null ? igEl : mountEl, 'ignitiondelay', 0);
  const resolveRef = (motorEl: Element, igEl: Element | undefined): OrkMotorRef => {
    // Carried through rather than used: the motor is resolved from our own
    // catalog, but a design saved again should still name the desktop entry the
    // file named, including for a motor we could not resolve. Absent stays
    // absent, so a file with no digest round-trips to one with no digest.
    const digest = text(motorEl, ':scope > digest');
    const maker = text(motorEl, ':scope > manufacturer')?.trim();
    return {
      // Empty when the file names none, never a placeholder word: the
      // designation reaches the mount label and the notes in the UI language,
      // and the chosen configuration's read below names the mount instead.
      designation: text(motorEl, ':scope > designation') ?? '',
      ...(digest ? { digest } : {}),
      // Absent stays absent: desktop's MotorHandler leaves the maker null, and
      // findMotors filters on a maker only when one is given.
      ...(maker ? { manufacturer: maker } : {}),
      diameter: nonNegTag(motorEl, 'diameter', 0.018),
      length: nonNegTag(motorEl, 'length', 0.07),
      delay: readDelay(motorEl),
      mountId: node.id,
      ignitionEvent: ignitionEvent(igEl),
      ignitionDelay: ignitionDelay(igEl),
    };
  };
  // Every declared configuration's motor rides along as a preset
  // (its own ignition override winning over the bare defaults, same as the
  // chosen read below). Quiet: only the chosen config's notes surface.
  if (node.id) {
    for (const cfg of ctx.configs) {
      const byId = (tag: string) =>
        Array.from(mountEl.children).find((c) => c.tagName === tag && c.getAttribute('configid') === cfg.id);
      const cfgMotorEl = byId('motor');
      if (!cfgMotorEl) continue; // no motor for this config here: empty
      cfg.motors[node.id] = resolveRef(cfgMotorEl, byId('ignitionconfiguration'));
    }
  }
  // A mount with no motor for the chosen configuration imports empty.
  const motorEl = configScoped(ctx, mountEl, 'motor');
  if (!motorEl) return;
  // Ignition: the chosen config's block over the bare defaults (desktop writes
  // defaults bare, overrides in <ignitionconfiguration>).
  const ref = resolveRef(motorEl, configScoped(ctx, mountEl, 'ignitionconfiguration') ?? undefined);
  // A motor with no designation cannot be looked up: desktop's MotorHandler
  // finds no motor for it and leaves the mount empty with a warning.
  if (!ref.designation) ctx.notes.push(keyedNote('importNote.motorNoDesignation', { mount: notePartName(node) }));
  if (ref.delay >= PLUGGED_DELAY) {
    const unstated = text(motorEl, ':scope > delay') !== 'none';
    ctx.notes.push(
      keyedNote(unstated ? 'importNote.motorPluggedNoDelay' : 'importNote.motorPlugged', { motor: ref.designation }),
    );
  }
  if (node.id) {
    ctx.motors[node.id] = ref;
  }
  if (!ctx.motor) ctx.motor = ref;
}
