import { PLUGGED_DELAY, type ComponentNode } from '../../../engine/openRocketEngine';
import { xmlText as text } from '../xmlUtil';
import type { OrkMotorRef, OrkFlightConfig } from '../orkTypes';
import { nonNegTag, numTag, readDeploymentTags, readSeparationTags } from './importTags';
import { MAX_MOTOR_CONFIGS } from './importLimits';
import { finiteNum } from './numbers';

/**
 * Flight configurations on the way in: the rocket-level declaration table,
 * which one the import applies, and the per-component reads that depend on it
 * (a mount's motors and ignition, a recovery device's deployment overrides).
 */

/** What every reader shares for one import: the config table and the result's accumulators. */
export interface OrkImportContext {
  configs: OrkFlightConfig[];
  chosenConfigId: string | null;
  notes: string[];
  ignored: Set<string>;
  /** Every mount's motor for the chosen configuration, keyed by node id. */
  motors: Record<string, OrkMotorRef>;
  /** The first motor found (legacy callers). */
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
 * A real design has a handful.
 */
export function readFlightConfigs(rocketEl: Element): {
  configEls: Element[];
  configs: OrkFlightConfig[];
  chosenConfigId: string | null;
} {
  const configEls = Array.from(rocketEl.querySelectorAll(':scope > motorconfiguration')).slice(0, MAX_MOTOR_CONFIGS);
  const configs: OrkFlightConfig[] = configEls
    .map((c) => ({
      id: c.getAttribute('configid') ?? '',
      name: text(c, ':scope > name'),
      isDefault: c.getAttribute('default') === 'true',
      motors: {},
      deployments: {},
      separations: {},
      grounded: [],
    }))
    .filter((c) => c.id !== '');
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
 * Record every configuration's <deploymentconfiguration> for this recovery
 * device, not just the chosen one. Export replays them so opening config A
 * and saving cannot rewrite config B's recovery settings (see
 * OrkFlightConfig.deployments).
 */
export function captureDeployments(ctx: OrkImportContext, el: Element, node: ComponentNode): void {
  for (const c of ctx.configs) {
    const block = Array.from(el.children).find(
      (x) => x.tagName === 'deploymentconfiguration' && x.getAttribute('configid') === c.id,
    );
    // Fall back to the bare tags for a configuration that declares no block
    // of its own. Recording the resolved value (not "nothing") is what makes
    // the round-trip safe: on save the bare defaults are rewritten from the
    // configuration the user opened, so a config that recorded nothing would
    // inherit the opened configuration's values instead.
    // The same reader as the design's own, floors included.
    const o = readDeploymentTags(block ?? el);
    if (Object.keys(o).length > 0 && node.id) c.deployments[node.id] = o;
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
      if (id) config.grounded.push(id);
    }
  }
}

/**
 * Record every configuration's <separationconfiguration> for this booster, the
 * way {@link captureDeployments} records its recovery.
 *
 * Same fallback for the same reason: a configuration that declares no block of
 * its own stages the way the bare tags say, and recording the resolved value is
 * what keeps a save from handing it the opened configuration's staging instead.
 */
export function captureSeparations(ctx: OrkImportContext, el: Element, node: ComponentNode): void {
  for (const c of ctx.configs) {
    const block = Array.from(el.children).find(
      (x) => x.tagName === 'separationconfiguration' && x.getAttribute('configid') === c.id,
    );
    const o = readSeparationTags(block ?? el);
    if (Object.keys(o).length > 0 && node.id) c.separations[node.id] = o;
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

/** A mount's <motormount>: the mount flag, its overhang, and every configuration's motor. */
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
  // One configuration's motor+ignition off this mount. Plugged motors (no
  // ejection charge): the desktop writes the literal string "none"
  // (Motor.PLUGGED_DELAY). Represent as the JSON-safe PLUGGED_DELAY sentinel,
  // which the engine maps to +Inf ("never fires") at the kernel boundary.
  const resolveRef = (motorEl: Element, igEl: Element): OrkMotorRef => {
    // Carried through rather than used: the motor is resolved from our own
    // catalog, but a design saved again should still name the desktop entry the
    // file named, including for a motor we could not resolve. Absent stays
    // absent, so a file with no digest round-trips to one with no digest.
    const digest = text(motorEl, ':scope > digest');
    return {
      designation: text(motorEl, ':scope > designation') ?? 'unknown',
      ...(digest ? { digest } : {}),
      manufacturer: text(motorEl, ':scope > manufacturer') ?? 'unknown',
      diameter: nonNegTag(motorEl, 'diameter', 0.018),
      length: nonNegTag(motorEl, 'length', 0.07),
      delay: readDelay(motorEl),
      mountId: node.id,
      ignitionEvent: text(igEl, ':scope > ignitionevent') ?? undefined,
      ignitionDelay: nonNegTag(igEl, 'ignitiondelay', 0),
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
      cfg.motors[node.id] = resolveRef(cfgMotorEl, byId('ignitionconfiguration') ?? mountEl);
    }
  }
  // A mount with no motor for the chosen configuration imports empty.
  const motorEl = configScoped(ctx, mountEl, 'motor');
  if (!motorEl) return;
  // Ignition: the chosen config's block wins over the bare default
  // (desktop writes defaults bare, overrides in <ignitionconfiguration>).
  const ref = resolveRef(motorEl, configScoped(ctx, mountEl, 'ignitionconfiguration') ?? mountEl);
  if (ref.delay >= PLUGGED_DELAY) {
    const unstated = text(motorEl, ':scope > delay') !== 'none' ? ' (the file gives no readable delay)' : '';
    ctx.notes.push(
      `Motor ${ref.designation}: plugged (no ejection charge)${unstated} — make sure recovery deploys on apogee/altitude, not the ejection charge.`,
    );
  }
  if (node.id) {
    ctx.motors[node.id] = ref;
  }
  if (!ctx.motor) ctx.motor = ref;
}
