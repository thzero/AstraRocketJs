import type { ComponentNode, ComponentPosition } from '../../engine/openRocketEngine';
import { xmlText as text } from '../xmlUtil';
import { COMPONENT_DEFAULTS } from '../componentDefaults';
import { clampCount, finiteNum } from './numbers';
import { MAX_ASSEMBLY_INSTANCES, MAX_FIN_COUNT } from './importLimits';

/**
 * Readers for the individual .ork elements more than one component carries:
 * numeric tags, materials, fin tabs and fillets, packed size, deployment,
 * separation, instances and axial position. Each reads one element group off
 * `el` and, where it writes, writes only the node keys for that group.
 */

/** Read a numeric child `<tag>` of an .ork element, or `fallback` when it's
 *  absent / non-finite. Not the tree-node reader (`nodeProps.num`): this parses
 *  XML text, including the "auto 0.012" flag+value form OpenRocket writes. */
export function numTag(el: Element, tag: string, fallback: number): number {
  const t = text(el, `:scope > ${tag}`);
  // Values like "auto 0.012" carry an automatic flag + last value.
  const v = t ? Number(t.split(/\s+/).pop()) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

/**
 * A radius OpenRocket may write as the sentinel `auto`.
 *
 * Inner structure takes its outer radius from whatever it sits in, and a
 * centering ring takes its inner radius from the motor mount through it. The
 * file says `auto` for those rather than a number, and the kernel recomputes
 * them as the design changes.
 *
 * `undefined` means automatic, which is how the rest of the app spells it: the
 * node simply has no radius key, `ComponentFactory` leaves the kernel's
 * automatic flag on, and the exporter writes `auto` straight back. Reading
 * `auto` as a NUMBER was the bug this replaces - `numTag` fell through to its
 * fallback, and every imported ring arrived with no radius at all, which the
 * required-dimension check then refused to fly.
 */
export function autoRadiusTag(el: Element, tag: string): number | undefined {
  const t = text(el, `:scope > ${tag}`)?.trim();
  if (!t || t.toLowerCase().startsWith('auto')) return undefined;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

/** `<isdrogue>` as OpenRocket writes it: present and "true" or absent altogether. */
export function isDrogueTag(el: Element): boolean {
  return (text(el, ':scope > isdrogue') ?? '').trim().toLowerCase() === 'true';
}

/** <fincount>, bounded to what the renderers can loop over. */
export function finCountTag(el: Element, fallback: number = COMPONENT_DEFAULTS.finset.finCount): number {
  return clampCount(numTag(el, 'fincount', fallback), 1, MAX_FIN_COUNT);
}

/**
 * A recovery device's packed size: <packedlength> as `length` (the key the
 * rest of the app already reads) and <packedradius> as `packedRadius`. The
 * radius was never read, and the writer emitted the MassObject constructor
 * constants for both, so a chute packed to its real bay came back the stock
 * 25 x 12.5 mm on every save. Kept only when it differs from the default the
 * writer falls back to, so an untouched design stays clean.
 */
export function readPackedSize(el: Element, node: ComponentNode): void {
  node['length'] = numTag(el, 'packedlength', COMPONENT_DEFAULTS.recovery.packedLength);
  const r = numTag(el, 'packedradius', NaN);
  if (!Number.isNaN(r) && r !== COMPONENT_DEFAULTS.recovery.packedRadius) node['packedRadius'] = r;
}

/** The bulk material's `group` attribute, when the file carries one (the
 *  name and density are read by `baseNode`). Pass-through, like readFillet. */
export function readMaterialGroup(el: Element, node: ComponentNode): void {
  const m = el.querySelector(':scope > material');
  if (!m || m.getAttribute('type') !== 'bulk') return;
  const group = m.getAttribute('group');
  if (group) node['materialGroup'] = group;
}

function matDensity(el: Element): number | undefined {
  const m = el.querySelector(':scope > material');
  if (!m || m.getAttribute('type') !== 'bulk') return undefined;
  const d = Number(m.getAttribute('density'));
  return Number.isFinite(d) && d > 0 ? d : undefined;
}

/** Material NAME if it's a real name (not the "custom" placeholder). */
function matName(el: Element, type: string, selector = ':scope > material'): string | undefined {
  const m = el.querySelector(selector);
  if (!m || m.getAttribute('type') !== type) return undefined;
  const name = m.textContent?.trim();
  return name && name.toLowerCase() !== 'custom' ? name : undefined;
}

/** Surface/line material density+name for recovery devices and cords. */
export function readSoftMaterial(
  el: Element,
  node: ComponentNode,
  kind: 'surface' | 'line',
  densityKey: string,
  nameKey: string,
  selector = ':scope > material',
): void {
  const m = el.querySelector(selector);
  if (!m || m.getAttribute('type') !== kind) return;
  const d = Number(m.getAttribute('density'));
  if (Number.isFinite(d) && d > 0) node[densityKey] = d;
  const name = matName(el, kind, selector);
  if (name) node[nameKey] = name;
}

/**
 * <instancecount>/<instanceseparation>, PASS-THROUGH only.
 *
 * CenteringRing and Bulkhead are LineInstanceable and LaunchLug/RailButton are
 * Instanceable, so OpenRocket writes these for all four. Neither was read, and
 * export hard-wrote 1 / 0.0 — so a motor mount declared as one CenteringRing
 * with instancecount 3 came back from a save as a single ring, permanently
 * losing two-thirds of that structural mass from the user's own file. The app
 * still simulates and draws ONE; the file keeps all N, and the import note
 * says so rather than letting the difference stay silent.
 */
export function readInstances(el: Element, node: ComponentNode): void {
  const count = clampCount(numTag(el, 'instancecount', 1), 1, MAX_ASSEMBLY_INSTANCES);
  if (count > 1) node['instanceCount'] = count;
  const sep = numTag(el, 'instanceseparation', 0);
  if (sep !== 0) node['instanceSeparation'] = sep;
}

/** Radial mounting angle (LaunchLug / RailButton) in RADIANS. OpenRocket writes
 *  it as <angleoffset> (degrees), older files as <radialdirection>; the kernel
 *  default is 180°. Stored in radians to match the tree/renderers. */
export function readAngleAroundBody(el: Element): number {
  const a = numTag(el, 'angleoffset', NaN);
  const deg = Number.isFinite(a) ? a : numTag(el, 'radialdirection', 180);
  return (deg * Math.PI) / 180;
}

/**
 * RASAero feature #4: supersonic airfoil section (our extension tags — the
 * desktop loader warns on unknown elements and continues, so files stay
 * openable there). Absent tags leave the classic cross-section behavior.
 */
export function readAirfoil(el: Element, node: ComponentNode): void {
  const section = text(el, ':scope > airfoilsection');
  if (section) node['airfoilSection'] = section;
  const led = numTag(el, 'airfoillediamond', 0);
  if (led > 0) node['airfoilLeDiamond'] = led;
  const ted = numTag(el, 'airfoiltediamond', 0);
  if (ted > 0) node['airfoilTeDiamond'] = ted;
  const ler = numTag(el, 'finleradius', 0);
  if (ler > 0) node['finLeRadius'] = ler;
  readFillet(el, node);
}

/**
 * Fin fillets, PASS-THROUGH only.
 *
 * OpenRocket's FinSetSaver writes <filletradius>/<filletmaterial> for every fin
 * set and counts the fillet volume toward fin mass. This app's kernel bridge
 * does not model fillets yet — but the exporter used to hard-write
 * `<filletradius>0.0</filletradius>` and a Cardboard material, so opening a
 * desktop design with 6 mm epoxy fillets and saving it DELETED them from the
 * user's own file. Preserving the values costs nothing and stops the
 * destruction; the mass still is not counted, which the import note says.
 */
function readFillet(el: Element, node: ComponentNode): void {
  const r = numTag(el, 'filletradius', 0);
  if (!(r > 0)) return;
  node['filletRadius'] = r;
  const m = el.querySelector(':scope > filletmaterial');
  if (!m) return;
  const d = Number(m.getAttribute('density'));
  if (Number.isFinite(d) && d > 0) node['filletDensity'] = d;
  const group = m.getAttribute('group');
  if (group) node['filletMaterialGroup'] = group;
  const name = (m.textContent ?? '').trim();
  if (name) node['filletMaterialName'] = name;
}

/** Fin-set rotation about the body axis (.ork stores DEGREES; we keep rad). */
export function readFinRotation(el: Element, node: ComponentNode): void {
  const deg = numTag(el, 'rotation', 0);
  if (deg !== 0) node['rotation'] = (deg * Math.PI) / 180;
}

/**
 * Fin tabs: <tabheight>, <tablength>, <tabposition relativeto="...">. Desktop
 * files carry TWO tabposition elements (legacy front/center/end + modern
 * top/middle/bottom) — like the desktop reader, the last one wins.
 */
export function readFinTabs(el: Element, node: ComponentNode): void {
  const h = numTag(el, 'tabheight', 0);
  const len = numTag(el, 'tablength', 0);
  if (h <= 0 || len <= 0) return;
  node['tabHeight'] = h;
  node['tabLength'] = len;
  const positions = Array.from(el.querySelectorAll(':scope > tabposition'));
  const last = positions[positions.length - 1];
  if (last) {
    const rel = (last.getAttribute('relativeto') ?? 'middle').toLowerCase();
    const method =
      rel.includes('front') || rel === 'top' ? 'top' : rel.includes('end') || rel === 'bottom' ? 'bottom' : 'middle';
    node['tabOffsetMethod'] = method;
    node['tabOffset'] = finiteNum(last.textContent) ?? 0;
  }
}

/**
 * Recovery-device deployment: the bare tags are the defaults; the chosen
 * config's <deploymentconfiguration> block (same child tag names) overrides
 * them PER FIELD — the desktop handler clones the default and applies only
 * the fields the block carries.
 */
export function readDeployment(el: Element, node: ComponentNode, configEl: Element | null = null): void {
  for (const src of configEl ? [el, configEl] : [el]) {
    const event = text(src, ':scope > deployevent');
    if (event) node['deployEvent'] = event;
    if (text(src, ':scope > deployaltitude') !== null) {
      node['deployAltitude'] = numTag(src, 'deployaltitude', 200);
    }
    if (text(src, ':scope > deploydelay') !== null) {
      node['deployDelay'] = numTag(src, 'deploydelay', 0);
    }
  }
}

/**
 * Stage separation (a lower <stage> or a strap-on <parallelstage>), read off
 * `sepEl`: the chosen config's <separationconfiguration> when there is one,
 * else the element itself carrying the bare defaults. Only values that differ
 * from the desktop defaults are kept, so an untouched stage stays clean.
 */
export function readSeparation(sepEl: Element, node: ComponentNode): void {
  const ev = text(sepEl, ':scope > separationevent');
  if (ev && ev !== 'ejection') node['separationEvent'] = ev;
  const delay = numTag(sepEl, 'separationdelay', 0);
  if (delay !== 0) node['separationDelay'] = delay;
  const alt = numTag(sepEl, 'separationaltitude', NaN);
  if (!Number.isNaN(alt) && alt !== 200) node['separationAltitude'] = alt;
}

function readPosition(el: Element): ComponentPosition | undefined {
  // Modern files write <axialoffset method="...">; OpenRocket ≤ 15.03 wrote
  // only <position type="..."> — fall back to it or old files lose every
  // fin/lug/inner-tube offset.
  const off = el.querySelector(':scope > axialoffset') ?? el.querySelector(':scope > position');
  if (!off) return undefined;
  const method = (off.getAttribute('method') ?? off.getAttribute('type') ?? 'top') as ComponentPosition['method'];
  // 'after' was missing, so every part using it lost its position entirely and
  // fell back to the parent's top — a part seated after its sibling jumped to
  // the front of the parent.
  if (!['top', 'middle', 'bottom', 'absolute', 'after'].includes(method)) return undefined;
  return { method, offset: finiteNum(off.textContent) ?? 0 };
}

/**
 * What EVERY component carries: name, bulk material, finish, the mass/CG/Cd
 * overrides and (for the types the desktop positions) the axial position.
 */
export function readCommon(el: Element, node: ComponentNode, withPosition: boolean): void {
  const nm = text(el, ':scope > name');
  if (nm) node.name = nm;
  const density = matDensity(el);
  if (density !== undefined) node.density = density;
  const bulkName = matName(el, 'bulk');
  if (bulkName) node['materialName'] = bulkName;
  const fin = text(el, ':scope > finish');
  if (fin && fin !== 'normal') node['finish'] = fin;
  const om = numTag(el, 'overridemass', NaN);
  if (!Number.isNaN(om)) node['overrideMass'] = om;
  const ocg = numTag(el, 'overridecg', NaN);
  if (!Number.isNaN(ocg)) node['overrideCGX'] = ocg;
  const ocd = numTag(el, 'overridecd', NaN);
  if (!Number.isNaN(ocd)) node['overrideCD'] = ocd;
  // "Override for all subcomponents": per-quantity flags (24.x format);
  // legacy files carry a single <overridesubcomponents> covering all.
  const legacyAll = text(el, ':scope > overridesubcomponents') === 'true';
  if (legacyAll || text(el, ':scope > overridesubcomponentsmass') === 'true') {
    node['overrideSubcomponentsMass'] = true;
  }
  if (legacyAll || text(el, ':scope > overridesubcomponentscg') === 'true') {
    node['overrideSubcomponentsCG'] = true;
  }
  if (legacyAll || text(el, ':scope > overridesubcomponentscd') === 'true') {
    node['overrideSubcomponentsCD'] = true;
  }
  if (withPosition) {
    const pos = readPosition(el);
    if (pos) node.position = pos;
  }
}
