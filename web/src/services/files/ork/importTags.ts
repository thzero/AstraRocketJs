import type { ComponentNode, ComponentPosition } from '../../../engine/openRocketEngine';
import { appPresetType } from './presetTypes';
import { xmlText as text } from '../xmlUtil';
import { COMPONENT_DEFAULTS } from '../../design/componentDefaults';
import { clampCount, finiteNum } from './numbers';
import { MAX_ASSEMBLY_INSTANCES, MAX_FIN_COUNT } from './importLimits';
import { EXTRA_KEY, readPassthrough } from './passthrough';
import type { OrkDeployOverride, OrkSepOverride } from '../orkTypes';
import { hexOf } from '../../design/colorHex';
import { degToRad } from '../../../prefs/units';
import { KERNEL_DEPLOYMENT, KERNEL_SEPARATION } from '../../../tree/kernelDefaults';
import { DEPLOY_EVENTS } from '../../design/componentFields';

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
 * A dimension or a mass off an .ork element: `numTag`, floored at zero.
 *
 * `numTag` accepts any finite value, so without the floor a
 * `<length>-5</length>` would reach the tree, the mesh, the mass integral and
 * the kernel, where a negative length is not a small design and not an error
 * either: it is geometry that inverts. The `.rkt` reader floors every
 * dimension it reads (`nonNeg` in `rktImport.ts`); this is the same floor on
 * the same quantities for the other format.
 *
 * Use it for a quantity no value of which can be negative: a length, a radius,
 * a diameter, a thickness, a chord, a mass. Not for a signed one: a fin
 * `<sweeplength>` is negative when the fin sweeps forward, an `<axialoffset>`
 * and a `<launchlatitude>` are signed, and a cant or a rotation is an angle.
 * Those keep `numTag`.
 */
export function nonNegTag(el: Element, tag: string, fallback: number): number {
  return Math.max(0, numTag(el, tag, fallback));
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
 * `auto` through `numTag` instead would fall through to its fallback and lose
 * the automatic flag.
 */
export function autoRadiusTag(el: Element, tag: string): number | undefined {
  const t = text(el, `:scope > ${tag}`)?.trim();
  if (!t || t.toLowerCase().startsWith('auto')) return undefined;
  // A stated 0 is a radius of 0, as DocumentConfig's setter sets it: desktop's
  // phantom tubes carry fins on a pod at the pod's own axis.
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 ? v : undefined;
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
 * `<packedradius>auto 0.0125</packedradius>` is how MassObjectSaver writes an
 * automatic packed radius for any mass object: the marker and the value it
 * worked out. Sets the flag, and the value when it is a usable one; false when
 * the radius is not automatic.
 */
export function readAutoPackedRadius(el: Element, node: ComponentNode): boolean {
  const raw = text(el, ':scope > packedradius')?.trim() ?? '';
  if (!raw.toLowerCase().startsWith('auto')) return false;
  node['radiusAuto'] = true;
  const v = Number(raw.slice(4).trim());
  if (Number.isFinite(v) && v > 0) node['radius'] = v;
  return true;
}

/**
 * A recovery device's packed size: <packedlength> as `length` and
 * <packedradius> as `radius`. Both are MassObject's own length and radius
 * upstream, which is why those are the names, and `radius` is the key the
 * engine bridge, the schematic and the 3D build all read. Under any other key
 * the value would survive a round trip through the file and reach nothing: the
 * kernel would fly the 12.5 mm default. Kept only when it differs from the
 * default the writer falls back to, so an untouched design stays clean.
 */
export function readPackedSize(el: Element, node: ComponentNode): void {
  node['length'] = nonNegTag(el, 'packedlength', COMPONENT_DEFAULTS.recovery.packedLength);
  if (readAutoPackedRadius(el, node)) return;
  const r = numTag(el, 'packedradius', NaN);
  if (r >= 0 && r !== COMPONENT_DEFAULTS.recovery.packedRadius) node['radius'] = r;
}

/** `<cd>auto</cd>`, `<linelength>auto</linelength>`, `<cordlength>auto</cordlength>`:
 *  a value the kernel works out, which the desktop shows as a checkbox. A line
 *  or cord length is written as its number with `<linelengthauto>true` or
 *  `<cordlengthauto>true` beside it, since desktop cannot read `auto` there. */
export function readAutoValue(el: Element, node: ComponentNode, tag: string, flag: string): boolean {
  if (
    (text(el, `:scope > ${tag}`)?.trim().toLowerCase() ?? '') === 'auto' ||
    (text(el, `:scope > ${tag}auto`)?.trim().toLowerCase() ?? '') === 'true'
  ) {
    node[flag] = true;
    return true;
  }
  return false;
}

/** The bulk material's `group` attribute, when the file carries one (the name
 *  and density are read by `matName` / `matDensity`). Pass-through, like
 *  readFillet. */
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

/** Material name if it's a real name (not the "custom" placeholder). */
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
 * <instancecount>/<instanceseparation>.
 *
 * CenteringRing and Bulkhead are LineInstanceable and LaunchLug/RailButton are
 * Instanceable, so OpenRocket writes these for all four. Carrying them keeps a
 * motor mount declared as one CenteringRing with instancecount 3 from coming
 * back from a save as a single ring. The simulation counts all N, and the side
 * and 3D views draw all N.
 */
export function readInstances(el: Element, node: ComponentNode): void {
  const count = clampCount(numTag(el, 'instancecount', 1), 1, MAX_ASSEMBLY_INSTANCES);
  if (count > 1) node['instanceCount'] = count;
  // A stated spacing is kept, 0 included: an absent one is the kernel's
  // constructor spacing (60 mm for a lug), not 0, so dropping a stated 0 would
  // pull a desktop file's stacked lugs apart.
  const sep = numTag(el, 'instanceseparation', NaN);
  if (Number.isFinite(sep)) node['instanceSeparation'] = sep;
}

/** Radial mounting angle (LaunchLug / RailButton) in radians. OpenRocket writes
 *  it as <angleoffset> (degrees), older files as <radialdirection>; the kernel
 *  default is 180°. Stored in radians to match the tree/renderers, and clamped
 *  to [-180°, 180°] as LaunchLug.setAngleOffset and RailButton.setAngleOffset
 *  clamp it when desktop loads the file: 270 flies as 180 there. */
export function readAngleAroundBody(el: Element): number {
  const a = numTag(el, 'angleoffset', NaN);
  const deg = Number.isFinite(a) ? a : numTag(el, 'radialdirection', 180);
  return Math.min(Math.PI, Math.max(-Math.PI, degToRad(deg)));
}

/**
 * Supersonic airfoil section, used by the RASAero export (our extension tags:
 * the desktop loader warns on unknown elements and continues, so files stay
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
 * Fin fillets.
 *
 * OpenRocket's FinSetSaver writes <filletradius>/<filletmaterial> for every fin
 * set and counts the fillet volume toward fin mass. The values are read onto the
 * node so the kernel bridge flies them (radius and material density) and a save
 * writes them back: hard-writing `<filletradius>0.0</filletradius>` and a
 * Cardboard material would delete a desktop design's 6 mm epoxy fillets from the
 * user's own file.
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

/** Fin-set rotation about the body axis (.ork stores degrees; we keep rad). */
export function readFinRotation(el: Element, node: ComponentNode): void {
  const deg = numTag(el, 'rotation', 0);
  if (deg !== 0) node['rotation'] = degToRad(deg);
}

/**
 * Fin tabs: <tabheight>, <tablength>, <tabposition relativeto="...">. Desktop
 * files carry two tabposition elements (legacy front/center/end + modern
 * top/middle/bottom); like the desktop reader, the last one wins.
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
 * Recovery-device deployment as the design states it: the bare tags, which are
 * desktop's default. A configuration's <deploymentconfiguration> block is that
 * configuration's override (captureDeployments), never the design's value.
 */
export function readDeployment(el: Element, node: ComponentNode): void {
  Object.assign(node, readDeploymentTags(el));
}

/**
 * A file's deploy event in the app's vocabulary. The desktop writes the enum
 * name lower-cased with the underscores removed and matches it the same way on
 * read (DocumentConfig.findEnum), so `lowerstageseparation` and the underscored
 * spelling name the one event. A token no event matches stays as written.
 */
function deployEventOfXml(token: string): string {
  const key = token.trim().toLowerCase().replace(/_/g, '');
  return DEPLOY_EVENTS.find((ev) => ev.replace(/_/g, '') === key) ?? token;
}

/**
 * The deployment tags one element states, and only those, the same way for the
 * design and for each configuration's override. Altitude and delay are floored:
 * a negative deploy altitude never fires the kernel's altitude trigger, and the
 * input field holds the same minimum.
 */
export function readDeploymentTags(src: Element): OrkDeployOverride {
  const o: OrkDeployOverride = {};
  const event = text(src, ':scope > deployevent');
  if (event) o.deployEvent = deployEventOfXml(event);
  if (text(src, ':scope > deployaltitude') !== null)
    o.deployAltitude = nonNegTag(src, 'deployaltitude', KERNEL_DEPLOYMENT.deployAltitude);
  if (text(src, ':scope > deploydelay') !== null)
    o.deployDelay = nonNegTag(src, 'deploydelay', KERNEL_DEPLOYMENT.deployDelay);
  return o;
}

/**
 * The separation tags one element states, and only those, floored the way
 * {@link readDeploymentTags} floors deployment, for the design and for each
 * configuration's override alike.
 */
export function readSeparationTags(src: Element): OrkSepOverride {
  const o: OrkSepOverride = {};
  const event = text(src, ':scope > separationevent');
  if (event) o.separationEvent = event;
  if (text(src, ':scope > separationdelay') !== null)
    o.separationDelay = nonNegTag(src, 'separationdelay', KERNEL_SEPARATION.separationDelay);
  if (text(src, ':scope > separationaltitude') !== null)
    o.separationAltitude = nonNegTag(src, 'separationaltitude', KERNEL_SEPARATION.separationAltitude);
  return o;
}

/**
 * Stage separation (a lower <stage> or a strap-on <parallelstage>) as the design
 * states it: the bare tags on `el`, with `configEl`'s fields over them when the
 * caller passes one, as the desktop handler clones the default and applies only
 * the fields a block carries. Only values that differ from the desktop defaults
 * are kept, so an untouched stage stays clean.
 */
export function readSeparation(el: Element, node: ComponentNode, configEl: Element | null = null): void {
  const o = { ...readSeparationTags(el), ...(configEl ? readSeparationTags(configEl) : {}) };
  if (o.separationEvent && o.separationEvent !== KERNEL_SEPARATION.separationEvent)
    node['separationEvent'] = o.separationEvent;
  if (o.separationDelay !== undefined && o.separationDelay !== KERNEL_SEPARATION.separationDelay)
    node['separationDelay'] = o.separationDelay;
  if (o.separationAltitude !== undefined && o.separationAltitude !== KERNEL_SEPARATION.separationAltitude)
    node['separationAltitude'] = o.separationAltitude;
}

function readPosition(el: Element): ComponentPosition | undefined {
  // Modern files write <axialoffset method="...">; OpenRocket ≤ 15.03 wrote
  // only <position type="...">; fall back to it or old files lose every
  // fin/lug/inner-tube offset.
  const off = el.querySelector(':scope > axialoffset') ?? el.querySelector(':scope > position');
  if (!off) return undefined;
  const method = (off.getAttribute('method') ?? off.getAttribute('type') ?? 'top') as ComponentPosition['method'];
  // 'after' must be in this list: a part whose method is rejected loses its
  // position and falls back to the parent's top, so a part seated after its
  // sibling would jump to the front of the parent.
  if (!['top', 'middle', 'bottom', 'absolute', 'after'].includes(method)) return undefined;
  return { method, offset: finiteNum(off.textContent) ?? 0 };
}

/**
 * What every component carries: name, bulk material, finish, the mass/CG/Cd
 * overrides and (for the types the desktop positions) the axial position.
 */
export function readCommon(el: Element, node: ComponentNode, withPosition: boolean): void {
  // Anything in this component we have no model for, kept as raw XML so a save
  // does not strip it (services/files/ork/passthrough.ts). First, so that a node
  // carrying only unknown elements still carries them.
  const extra = readPassthrough(el);
  if (extra) node[EXTRA_KEY] = extra;
  const nm = text(el, ':scope > name');
  if (nm) node.name = nm;
  // The desktop's Comment tab. Carried through so a builder's notes survive a
  // round trip; nothing in the app reads it but the panel.
  const cmt = text(el, ':scope > comment');
  if (cmt) node['comment'] = cmt;
  // The 2D line style the desktop draws this part with. Carried, not shown:
  // our schematic has one line style, so a control for it would do nothing.
  const ls = text(el, ':scope > linestyle');
  if (ls) node['lineStyle'] = ls;
  // Which catalog part this component came from. The desktop shows it at the
  // top of every config dialog (the Parts Library row), and our own picker is
  // the same control, so the link is a fact about the design and not an
  // implementation detail of the file.
  const preset = el.querySelector(':scope > preset');
  if (preset) {
    const partNo = preset.getAttribute('partno');
    if (partNo) {
      node['preset'] = {
        // The file carries the kernel's enum constant (NOSE_CONE); the picker
        // and the panel speak our row types.
        type: appPresetType(preset.getAttribute('type') ?? ''),
        manufacturer: preset.getAttribute('manufacturer') ?? '',
        partNo,
        ...(preset.getAttribute('digest') ? { digest: preset.getAttribute('digest') } : {}),
      };
    }
  }
  const density = matDensity(el);
  if (density !== undefined) node.density = density;
  const bulkName = matName(el, 'bulk');
  if (bulkName) node['materialName'] = bulkName;
  const fin = text(el, ':scope > finish');
  if (fin && fin !== 'normal') node['finish'] = fin;
  // The part's own color: three 0-255 channels on one element in the file, a
  // hex string in the tree, which is what the pickers and both views use. The
  // desktop's ORColor.fromXMLAttributes reads no color at all unless all three
  // channels (and the alpha, when present) are integers in 0-255.
  const col = el.querySelector(':scope > color');
  if (col) {
    const ch = (name: string): number | null => {
      const raw = col.getAttribute(name);
      if (raw == null || !/^[+-]?\d+$/.test(raw)) return null;
      const v = Number(raw);
      return v >= 0 && v <= 255 ? v : null;
    };
    const [r, g, b] = [ch('red'), ch('green'), ch('blue')];
    const alphaOk = !col.hasAttribute('alpha') || ch('alpha') !== null;
    if (r !== null && g !== null && b !== null && alphaOk) {
      node['color'] = hexOf((r << 16) | (g << 8) | b);
    }
  }
  readOverrides(el, node);
  if (withPosition) {
    const pos = readPosition(el);
    if (pos) node.position = pos;
  }
}

/** Mass / CG / Cd overrides, and the flags that spread them over the subtree. */
function readOverrides(el: Element, node: ComponentNode): void {
  // Mass and CG are floored, like the .rkt reader's
  // `Math.max(0, knownMass / MASS)` and `Math.max(0, knownCg)`. A negative mass
  // override is not a lighter part: it subtracts from the rocket's total mass,
  // pulls the CG off the airframe and takes the stability margin with it, and
  // the override is by definition the figure that wins over everything computed.
  const om = numTag(el, 'overridemass', NaN);
  if (om >= 0) node['overrideMass'] = om;
  const ocg = numTag(el, 'overridecg', NaN);
  if (ocg >= 0) node['overrideCGX'] = ocg;
  // The Cd override takes any finite value, as `setOverrideCD` and the desktop
  // dialog do: a negative figure offsets drag the rest of the design adds.
  const ocd = numTag(el, 'overridecd', NaN);
  if (Number.isFinite(ocd)) node['overrideCD'] = ocd;
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
}
