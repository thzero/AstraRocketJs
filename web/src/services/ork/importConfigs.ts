import { PLUGGED_DELAY, type ComponentNode } from '../../engine/openRocketEngine';
import { xmlText as text } from '../xmlUtil';
import type { OrkMotorRef, OrkFlightConfig, OrkDeployOverride } from '../orkTypes';
import { numTag } from './importTags';
import { MAX_MOTOR_CONFIGS } from './importLimits';

/**
 * Flight configurations on the way IN: the rocket-level declaration table,
 * which one the import applies, and the per-component reads that depend on it
 * (a mount's motors and ignition, a recovery device's deployment overrides).
 */

/** What every reader shares for one import: the config table and the result's accumulators. */
export interface OrkImportContext {
  configs: OrkFlightConfig[];
  chosenConfigId: string | null;
  notes: string[];
  ignored: Set<string>;
  /** EVERY mount's motor for the chosen configuration, keyed by node id. */
  motors: Record<string, OrkMotorRef>;
  /** The first motor found (legacy callers). */
  motor: OrkMotorRef | undefined;
}

/**
 * Flight-configuration table: rocket-level <motorconfiguration> blocks
 * (optional <name>, optional default="true" — desktop 24.12
 * MotorConfigurationHandler).
 * Capped like the archive itself. `captureDeployments` and `configScoped`
 * both scan a component's children once PER CONFIG, so a ~500 KB file
 * declaring 20 000 configurations against a few thousand components makes
 * the import O(configs x children) on the main thread and freezes the tab.
 * A real design has a handful.
 */
export function readFlightConfigs(
  rocketEl: Element,
  requested: string | undefined,
): { configEls: Element[]; configs: OrkFlightConfig[]; chosenConfigId: string | null } {
  const configEls = Array.from(rocketEl.querySelectorAll(':scope > motorconfiguration')).slice(0, MAX_MOTOR_CONFIGS);
  const configs: OrkFlightConfig[] = configEls
    .map((c) => ({
      id: c.getAttribute('configid') ?? '',
      name: text(c, ':scope > name'),
      isDefault: c.getAttribute('default') === 'true',
      motors: {},
      deployments: {},
    }))
    .filter((c) => c.id !== '');
  const chosenConfigId =
    (requested != null && configs.some((c) => c.id === requested) ? requested : null) ??
    configs.find((c) => c.isDefault)?.id ??
    configs[0]?.id ??
    null;
  return { configEls, configs, chosenConfigId };
}

// The chosen configuration's child of `el` by tag name (per-config motor
// or override block). With no declared configs, the first such child —
// hand-rolled files may key <motor configid>s without declarations, and
// first-in-document-order is the long-standing read for them.
export function configScoped(ctx: OrkImportContext, el: Element, tag: string): Element | null {
  return ctx.chosenConfigId === null
    ? el.querySelector(`:scope > ${tag}`)
    : (Array.from(el.children).find((c) => c.tagName === tag && c.getAttribute('configid') === ctx.chosenConfigId) ??
        null);
}

/**
 * Record EVERY configuration's <deploymentconfiguration> for this recovery
 * device, not just the chosen one. Export replays them so opening config A
 * and saving cannot rewrite config B's recovery settings (see
 * OrkFlightConfig.deployments).
 */
export function captureDeployments(ctx: OrkImportContext, el: Element, node: ComponentNode): void {
  for (const c of ctx.configs) {
    const block = Array.from(el.children).find(
      (x) => x.tagName === 'deploymentconfiguration' && x.getAttribute('configid') === c.id,
    );
    // Fall back to the BARE tags for a configuration that declares no block
    // of its own. Recording the resolved value (not "nothing") is what makes
    // the round-trip safe: on save the bare defaults are rewritten from the
    // configuration the user opened, so a config that silently inherited the
    // old defaults would otherwise inherit the NEW ones instead.
    const src = block ?? el;
    const o: OrkDeployOverride = {};
    const event = text(src, ':scope > deployevent');
    if (event) o.deployEvent = event;
    if (text(src, ':scope > deployaltitude') !== null) o.deployAltitude = numTag(src, 'deployaltitude', 200);
    if (text(src, ':scope > deploydelay') !== null) o.deployDelay = numTag(src, 'deploydelay', 0);
    if (Object.keys(o).length > 0 && node.id) c.deployments[node.id] = o;
  }
}

/** A mount's <motormount>: the mount flag, its overhang, and every configuration's motor. */
export function readMotor(ctx: OrkImportContext, el: Element, node: ComponentNode): void {
  const mountEl = el.querySelector(':scope > motormount');
  if (!mountEl) return;
  // Any tube with a <motormount> IS a mount — an inner tube, or a body tube
  // on a minimum-diameter rocket (kernel BodyTube implements MotorMount,
  // same as the desktop). The flag survives even with no motor loaded.
  node['motorMount'] = true;
  // Motor overhang (m): aft protrusion past the mount — min-diameter practice.
  const overhang = numTag(mountEl, 'overhang', 0);
  if (overhang !== 0) node['motorOverhang'] = overhang;
  // ONE configuration's motor+ignition off this mount. Plugged motors (no
  // ejection charge): the desktop writes the literal string "none"
  // (Motor.PLUGGED_DELAY). Represent as the JSON-safe PLUGGED_DELAY sentinel,
  // which the engine maps to +Inf ("never fires") at the kernel boundary.
  const resolveRef = (motorEl: Element, igEl: Element): OrkMotorRef => {
    const delayText = text(motorEl, ':scope > delay');
    return {
      designation: text(motorEl, ':scope > designation') ?? 'unknown',
      manufacturer: text(motorEl, ':scope > manufacturer') ?? 'unknown',
      diameter: numTag(motorEl, 'diameter', 0.018),
      length: numTag(motorEl, 'length', 0.07),
      delay: delayText === 'none' ? PLUGGED_DELAY : numTag(motorEl, 'delay', 0),
      mountId: node.id,
      ignitionEvent: text(igEl, ':scope > ignitionevent') ?? undefined,
      ignitionDelay: numTag(igEl, 'ignitiondelay', 0),
    };
  };
  // Stage B: EVERY declared configuration's motor rides along as a preset
  // (its own ignition override winning over the bare defaults, same as the
  // chosen read below). Quiet — only the chosen config's notes surface.
  if (node.id) {
    for (const cfg of ctx.configs) {
      const byId = (tag: string) =>
        Array.from(mountEl.children).find((c) => c.tagName === tag && c.getAttribute('configid') === cfg.id);
      const cfgMotorEl = byId('motor');
      if (!cfgMotorEl) continue; // no motor for this config here — empty
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
    ctx.notes.push(
      `Motor ${ref.designation}: plugged (no ejection charge) — make sure recovery deploys on apogee/altitude, not the ejection charge.`,
    );
  }
  if (node.id) {
    ctx.motors[node.id] = ref;
  }
  if (!ctx.motor) ctx.motor = ref;
}
