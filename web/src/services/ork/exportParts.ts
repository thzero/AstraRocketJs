import type { ComponentNode, ComponentPosition } from '../../engine/openRocketEngine';
import { shapeParamDefault } from '../../tree/shapeProfile';
import { num } from '../../tree/nodeProps';
import { escapeXml } from '../xmlUtil';
import { uuid } from '../uuid';
import { COMPONENT_DEFAULTS } from '../componentDefaults';
import type { OrkDeployOverride, OrkSepOverride } from '../orkTypes';
import type { OrkWriter } from './exportWriter';
import { passthroughOf } from './passthrough';

/**
 * The element groups more than one .ork component writer shares: material,
 * axial position, name/id/override header, fin angle and tabs, fillets, packed
 * size, deployment and separation blocks. Each writes at the depth it is given
 * and nothing else, so the per-type writers in `exportWriters.ts` read as the
 * element order the desktop savers use.
 */

/** The desktop's stock bulk material, written when a part carries none. */
const CARDBOARD = { name: 'Cardboard', density: 680, group: 'PaperProducts' } as const;

export function material(
  w: OrkWriter,
  depth: number,
  node: ComponentNode,
  kind: 'bulk' | 'surface' | 'line' = 'bulk',
  bulkFallback: { name: string; density: number; group: string } = CARDBOARD,
): void {
  const { emit } = w;
  if (kind === 'bulk') {
    if (typeof node.density === 'number' && node.density > 0) {
      const name = typeof node['materialName'] === 'string' ? (node['materialName'] as string) : 'custom';
      // The group rides along when the reader kept one (readMaterialGroup),
      // so a desktop material round-trips with its catalog category.
      const group =
        typeof node['materialGroup'] === 'string' ? ` group="${escapeXml(node['materialGroup'] as string)}"` : '';
      emit(depth, `<material type="bulk" density="${node.density}"${group}>${escapeXml(name)}</material>`);
    } else {
      emit(
        depth,
        `<material type="bulk" density="${bulkFallback.density}" group="${escapeXml(bulkFallback.group)}">` +
          `${escapeXml(bulkFallback.name)}</material>`,
      );
    }
  } else if (kind === 'surface') {
    if (typeof node['surfaceDensity'] === 'number') {
      const name = typeof node['surfaceMaterialName'] === 'string' ? (node['surfaceMaterialName'] as string) : 'custom';
      emit(depth, `<material type="surface" density="${node['surfaceDensity']}">${escapeXml(name)}</material>`);
    } else {
      emit(depth, '<material type="surface" density="0.067" group="Fabrics">Ripstop nylon</material>');
    }
  } else {
    if (typeof node['lineDensity'] === 'number') {
      const name = typeof node['lineMaterialName'] === 'string' ? (node['lineMaterialName'] as string) : 'custom';
      emit(depth, `<material type="line" density="${node['lineDensity']}">${escapeXml(name)}</material>`);
    } else {
      emit(
        depth,
        '<material type="line" density="0.0018" group="ThreadsLines">Elastic cord (round 2 mm, 1/16 in)</material>',
      );
    }
  }
}

export function position(
  w: OrkWriter,
  depth: number,
  node: ComponentNode,
  dflt: ComponentPosition['method'] = 'top',
): void {
  const pos = (node.position ?? { method: dflt, offset: 0 }) as ComponentPosition;
  // An imported `absolute` position was rewritten to the parent frame on load
  // (see ComponentPosition.ork). Write the original back so a round-trip is
  // byte-stable -- but only while the user has not moved the part, in which
  // case the current parent-relative position is the truthful one.
  const src = pos.ork && pos.method === 'top' && pos.ork.resolved === pos.offset ? pos.ork : pos;
  w.emit(depth, `<axialoffset method="${src.method}">${src.offset}</axialoffset>`);
  w.emit(depth, `<position type="${src.method}">${src.offset}</position>`);
}

export function header(w: OrkWriter, depth: number, node: ComponentNode, fallback: string): void {
  w.emit(depth, `<name>${escapeXml(node.name ?? fallback)}</name>`);
  w.emit(depth, `<id>${uuid()}</id>`);
  if (typeof node['comment'] === 'string' && node['comment']) {
    w.emit(depth, `<comment>${escapeXml(node['comment'] as string)}</comment>`);
  }
  if (typeof node['lineStyle'] === 'string' && node['lineStyle']) {
    w.emit(depth, `<linestyle>${escapeXml(node['lineStyle'] as string)}</linestyle>`);
  }
  presetXml(w, depth, node);
  colorXml(w, depth, node);
  overrides(w, depth, node);
  // Whatever the file carried that this app has no model for, back where it was
  // (services/ork/passthrough.ts). Last in the header so it cannot come between
  // two elements the desktop's own reader expects in order.
  for (const raw of passthroughOf(node)) w.emit(depth, raw);
}

/**
 * The catalog part this component came from, as `RocketComponentSaver` writes
 * it. Kept only while the component still MATCHES it: `treeEdit` drops the link
 * the moment a dimension changes, the same way the kernel's setters call
 * `clearPreset`, so a link can never claim a part number the geometry no longer
 * is.
 */
function presetXml(w: OrkWriter, depth: number, node: ComponentNode): void {
  const p = node['preset'] as { type?: string; manufacturer?: string; partNo?: string; digest?: string } | undefined;
  if (!p || typeof p !== 'object' || !p.partNo) return;
  const attr = (name: string, v: string | undefined) => (v ? ` ${name}="${escapeXml(v)}"` : '');
  w.emit(
    depth,
    `<preset${attr('type', p.type)}${attr('manufacturer', p.manufacturer)}${attr('partno', p.partNo)}${attr('digest', p.digest)}/>`,
  );
}

/**
 * A part's own color, as the desktop stores it: three 0-255 channels on one
 * element, absent when the part takes its group color.
 *
 * The app has had a color picker for a long time and this was written nowhere,
 * so a design saved as `.ork` came back in its group color. It is the only place the editor
 * offered a control and then threw the answer away.
 */
function colorXml(w: OrkWriter, depth: number, node: ComponentNode): void {
  const hex = typeof node['color'] === 'string' ? (node['color'] as string) : null;
  const m = hex && /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return;
  const n = parseInt(m[1]!, 16);
  w.emit(depth, `<color red="${(n >> 16) & 255}" green="${(n >> 8) & 255}" blue="${n & 255}"/>`);
}

// Mass/CG/Cd overrides, exactly as the desktop RocketComponentSaver writes them.
export function overrides(w: OrkWriter, depth: number, node: ComponentNode): void {
  const sub = (key: string) => (node[key] === true ? 'true' : 'false');
  if (typeof node['overrideMass'] === 'number') {
    w.emit(depth, `<overridemass>${node['overrideMass']}</overridemass>`);
    w.emit(depth, `<overridesubcomponentsmass>${sub('overrideSubcomponentsMass')}</overridesubcomponentsmass>`);
  }
  if (typeof node['overrideCGX'] === 'number') {
    w.emit(depth, `<overridecg>${node['overrideCGX']}</overridecg>`);
    w.emit(depth, `<overridesubcomponentscg>${sub('overrideSubcomponentsCG')}</overridesubcomponentscg>`);
  }
  if (typeof node['overrideCD'] === 'number') {
    w.emit(depth, `<overridecd>${node['overrideCD']}</overridecd>`);
    w.emit(depth, `<overridesubcomponentscd>${sub('overrideSubcomponentsCD')}</overridesubcomponentscd>`);
  }
}

// RASAero feature #4: supersonic airfoil section — our extension tags,
// written only when set (the desktop loader warns-and-continues on them).
export function airfoilXml(w: OrkWriter, depth: number, node: ComponentNode): void {
  const section = node['airfoilSection'];
  if (typeof section === 'string' && section) {
    w.emit(depth, `<airfoilsection>${escapeXml(section)}</airfoilsection>`);
  }
  for (const [key, tag] of [
    ['airfoilLeDiamond', 'airfoillediamond'],
    ['airfoilTeDiamond', 'airfoiltediamond'],
    ['finLeRadius', 'finleradius'],
  ] as const) {
    const v = node[key];
    if (typeof v === 'number' && v > 0) w.emit(depth, `<${tag}>${v}</${tag}>`);
  }
}

/**
 * Per-configuration recovery deployment: when this device opens under each
 * configuration.
 *
 * A configuration that overrides nothing takes the live tree's values, which are
 * already written as the bare defaults just above, so its block simply repeats
 * them. One that overrides writes what it overrides. Without this, saving after
 * opening one configuration rewrote every configuration's recovery settings to
 * the opened one's — a chute set to pop at apogee in config A could come back
 * deploying at 300 m.
 */
export function deploymentConfigs(w: OrkWriter, depth: number, node: ComponentNode): void {
  // Nothing to say when there is one configuration and it recovers the way the
  // design does: the bare tags above already say it. One configuration that
  // DOES override still needs its block, or the override would be the one thing
  // the file lost.
  if (w.writeConfigs.length < 2 && !w.writeConfigs[0]?.deployments) return;
  for (const c of w.writeConfigs) {
    const o: OrkDeployOverride =
      c.deployments === null
        ? {
            deployEvent: String(node['deployEvent'] ?? 'ejection'),
            deployAltitude: typeof node['deployAltitude'] === 'number' ? (node['deployAltitude'] as number) : 200,
            deployDelay: typeof node['deployDelay'] === 'number' ? (node['deployDelay'] as number) : 0,
          }
        : node.id
          ? (c.deployments[node.id] ?? {})
          : {};
    if (Object.keys(o).length === 0) continue;
    w.emit(depth, `<deploymentconfiguration configid="${escapeXml(c.id)}">`);
    if (o.deployEvent !== undefined) w.emit(depth + 1, `<deployevent>${escapeXml(o.deployEvent)}</deployevent>`);
    if (o.deployAltitude !== undefined) w.emit(depth + 1, `<deployaltitude>${o.deployAltitude}</deployaltitude>`);
    if (o.deployDelay !== undefined) w.emit(depth + 1, `<deploydelay>${o.deployDelay}</deploydelay>`);
    w.emit(depth, '</deploymentconfiguration>');
  }
}

/**
 * The fin fillet: the glue bead along the root (see readFillet). The node's own
 * radius and material are written when it has them, so a save cannot delete a
 * designer's epoxy fillets from their own .ork.
 *
 * The Cardboard fallback applies only when the design names no fillet material,
 * and is not arbitrary: Cardboard at 680 kg/m3 is what the KERNEL uses for a
 * fillet with no material (ApplicationPreferences.getDefaultComponentMaterial
 * for BULK), so the mass this app flies and the mass desktop OpenRocket computes
 * from the file it writes agree either way.
 *
 * The group is written only when the design carries one, the way `material`
 * above does. Defaulting it to PaperProducts would file a Fiberglass fillet
 * under paper.
 */
export function filletXml(w: OrkWriter, depth: number, node: ComponentNode): void {
  w.emit(depth, `<filletradius>${num(node, 'filletRadius', 0)}</filletradius>`);
  const density = typeof node['filletDensity'] === 'number' ? (node['filletDensity'] as number) : null;
  if (density === null || !(density > 0)) {
    w.emit(
      depth,
      `<filletmaterial type="bulk" density="${CARDBOARD.density}" group="${CARDBOARD.group}">${CARDBOARD.name}</filletmaterial>`,
    );
    return;
  }
  const matName = typeof node['filletMaterialName'] === 'string' ? (node['filletMaterialName'] as string) : 'custom';
  const group =
    typeof node['filletMaterialGroup'] === 'string'
      ? ` group="${escapeXml(node['filletMaterialGroup'] as string)}"`
      : '';
  w.emit(depth, `<filletmaterial type="bulk" density="${density}"${group}>` + `${escapeXml(matName)}</filletmaterial>`);
}

/**
 * A fin set's placement around the body. The desktop writes <angleoffset>
 * and the 15.03-compat <rotation> from the SAME value
 * (RocketComponentSaver.java:125-130: both are angleOffset in degrees), so both
 * get the real angle here. Writing it only into the 15.03-compat <rotation>
 * leaves a reader that trusts the modern element, as the desktop does, to read
 * every fin set this app saves as having no rotation at all.
 */
export function finAngleXml(w: OrkWriter, depth: number, node: ComponentNode, method: 'relative' | 'fixed'): void {
  const deg = (num(node, 'rotation', 0) * 180) / Math.PI;
  w.emit(depth, `<angleoffset method="${method}">${deg}</angleoffset>`);
  w.emit(depth, `<rotation>${deg}</rotation>`);
}

export function finishXml(w: OrkWriter, depth: number, node: ComponentNode): void {
  // finish (like shape/crosssection/cluster below) is file-sourced free
  // text on import — escape it or a crafted file breaks the re-export.
  w.emit(depth, `<finish>${escapeXml(String(node['finish'] ?? 'normal'))}</finish>`);
}

// Fin tabs — written like the desktop's FinSetSaver: only when both depth
// and length are nonzero, with the legacy relativeto spelling first
// (front/center/end, OR 15.03 compat) then the modern one (top/middle/
// bottom); readers apply the last occurrence.
export function finTabsXml(w: OrkWriter, depth: number, node: ComponentNode): void {
  const h = num(node, 'tabHeight', 0);
  const len = num(node, 'tabLength', 0);
  if (h <= 0 || len <= 0) return;
  const method = typeof node['tabOffsetMethod'] === 'string' ? (node['tabOffsetMethod'] as string) : 'middle';
  const legacy = method === 'top' ? 'front' : method === 'bottom' ? 'end' : 'center';
  const offset = num(node, 'tabOffset', 0);
  w.emit(depth, `<tabheight>${h}</tabheight>`);
  w.emit(depth, `<tablength>${len}</tablength>`);
  w.emit(depth, `<tabposition relativeto="${legacy}">${offset}</tabposition>`);
  w.emit(depth, `<tabposition relativeto="${method}">${offset}</tabposition>`);
}

// The desktop encodes "solid" as <thickness>filled</thickness>.
export function thicknessXml(w: OrkWriter, depth: number, node: ComponentNode, fb: number): void {
  w.emit(
    depth,
    node['filled'] === true
      ? '<thickness>filled</thickness>'
      : `<thickness>${typeof node['thickness'] === 'number' ? node['thickness'] : fb}</thickness>`,
  );
}

/**
 * A recovery device's packed size, from the node (see readPackedSize). The
 * MassObject constructor constants are the fallback only when the design
 * genuinely never said; writing them unconditionally would throw away the packed
 * length the reader brought in.
 */
export function packedXml(w: OrkWriter, depth: number, node: ComponentNode): void {
  w.emit(depth, `<packedlength>${num(node, 'length', COMPONENT_DEFAULTS.recovery.packedLength)}</packedlength>`);
  // `radius`, not `packedRadius`: the reader puts <packedradius> into `radius`
  // and the engine bridge reads `radius`, so the writer was reading a key
  // nothing in the app ever sets and every save wrote the 12.5 mm constant.
  w.emit(depth, packedRadiusXml(node, COMPONENT_DEFAULTS.recovery.packedRadius));
}

// Engine defaults from Transition.Shape.defaultParameter() — writing any
// other fallback silently reshapes the nose (haack's default is 0, not 1).
export function shapeParamXml(w: OrkWriter, depth: number, node: ComponentNode): void {
  const dflt = shapeParamDefault(String(node['shape'] ?? 'ogive'));
  w.emit(depth, `<shapeparameter>${num(node, 'shapeParameter', dflt)}</shapeparameter>`);
}

/**
 * A radius that may be automatic: the number when the part carries one, the
 * sentinel `auto` when it does not.
 *
 * Inner structure takes its outer radius from whatever it sits in, so `auto` is
 * a real answer rather than a missing one. Hard-wiring `auto` throws away a ring
 * the user sized by hand: it exports as automatic and comes back the width of
 * its body tube.
 *
 * Emitted as `<packedradius>`, in the `auto <value>` form MassObjectSaver writes.
 */
export function packedRadiusXml(node: ComponentNode, fallback: number): string {
  const v = num(node, 'radius', fallback);
  return `<packedradius>${node['radiusAuto'] === true ? `auto ${v}` : v}</packedradius>`;
}

export function autoRadius(w: OrkWriter, depth: number, node: ComponentNode, key: string, tag: string): void {
  // The FLAG decides, because the value beside it is the RESOLVED number: a
  // ring that fills its tube now carries the bore it filled, and writing that
  // number would turn a design that follows its tube into one that is pinned
  // to whatever the tube happened to be. An absent value still means auto,
  // which is how a tree built before the flag existed spells it.
  const v = node[key];
  const auto = node[`${key}Auto`] === true || !(typeof v === 'number' && v > 0);
  w.emit(depth, `<${tag}>${auto ? 'auto' : v}</${tag}>`);
}

/**
 * A stage's (or strap-on booster's) separation: the DEFAULT params written
 * bare, then one <separationconfiguration> per config (AxialStageSaver writes
 * the same pair for a lower <stage>).
 *
 * A configuration that stages differently writes its own values into its block;
 * the rest repeat the design's. Writing the design's for all of them, as this
 * once did, made saving after opening one configuration the moment every other
 * one forgot when its booster let go.
 */
export function separationXml(w: OrkWriter, depth: number, node: ComponentNode): void {
  const ev = typeof node['separationEvent'] === 'string' ? (node['separationEvent'] as string) : 'ejection';
  const delay = typeof node['separationDelay'] === 'number' ? (node['separationDelay'] as number) : 0;
  const alt = typeof node['separationAltitude'] === 'number' ? (node['separationAltitude'] as number) : 200;
  const sep = (d: number, o: OrkSepOverride) => {
    w.emit(d, `<separationevent>${escapeXml(o.separationEvent ?? ev)}</separationevent>`);
    w.emit(d, `<separationaltitude>${o.separationAltitude ?? alt}</separationaltitude>`);
    w.emit(d, `<separationdelay>${o.separationDelay ?? delay}</separationdelay>`);
  };
  sep(depth, {});
  for (const c of w.writeConfigs) {
    w.emit(depth, `<separationconfiguration configid="${escapeXml(c.id)}">`);
    // The configuration's own values where it has them, the design's where it
    // does not. Every configuration gets a block, as the desktop's saver writes
    // one per configuration whether or not it differs.
    sep(depth + 1, (node.id && c.separations?.[node.id]) || {});
    w.emit(depth, '</separationconfiguration>');
  }
}
