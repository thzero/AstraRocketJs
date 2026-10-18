import * as THREE from 'three';
import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { bodyTubeRadius, countOf, finCant, num, numOpt } from '../../tree/nodeProps';
import { axialChain, motorSeatStart, partLength } from '../../tree/position';
import { FIN_DEFAULTS, KERNEL_DEFAULTS } from '../../tree/kernelDefaults';
import {
  FREEFORM_FALLBACK,
  bodyRadiusAt,
  finMount,
  finPointsWithRoot,
  finRootChord,
  finSpan,
  mountRadius,
  type FinParent,
} from '../../tree/finPlanform';
import {
  assemblyBoundingRadius,
  assemblyChainLength,
  assemblyParentRadius,
  isAssembly,
  resolveAssemblyRadius,
  ringInstanceOffsets,
} from '../../tree/assembly.js';
import { lineInstances, placementOffsets } from '../../tree/placement';
import { isPlanarFinSet, tubeFinRadius } from '../../tree/tubefins.js';
import { nodeShape, outerProfile, profileEnds } from '../../tree/shapeProfile.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEFAULT_PART_COLORS, type PartPalette } from '../../services/design/partColors';
import { figureLooks, partLooks, type Look } from '../../services/design/appearance';
import { COMPONENT_DEFAULTS } from '../../services/design/componentDefaults';
import { DISC_TYPES } from '../../services/files/componentFormats';
import { resolveDisc } from '../../services/design/discGeometry';
import { axialStart, innerTubeExtent, internalExtent, type MotorDims } from '../../tree/schematicGeometry';
import { withKernelEnds } from '../../services/design/autoRadius';
import { railButtonSize } from './railButton';

/**
 * Owns the 3D geometry of the rocket: the component tree to Piece list build
 * (`buildPieces`, shared with the flight path view), the
 * bounds of that list, and the marker size rule the callouts hang off. Pure
 * three.js, no React.
 * Rocket axis = +X (nose tip at x=0, aft increasing), matching the engine.
 */

/**
 * The looks a piece is drawn with, by surface. A piece whose geometry has
 * groups draws each group with the look its `materialIndex` names (see
 * {@link SURFACE}); one without draws all of it with `outside`.
 */
export interface PieceLooks {
  outside: Look;
  inside: Look;
  edges: Look;
}

/** The `materialIndex` of each surface in a grouped piece geometry. */
export const SURFACE = { outside: 0, inside: 1, edges: 2 } as const;

/**
 * Whether a geometry's groups are {@link SURFACE}s. three.js's own primitives
 * carry groups of their own (a box has six), so a group alone does not say so.
 */
export const isSurfaced = (g: THREE.BufferGeometry): boolean => g.userData['surfaced'] === true;
const markSurfaced = (g: THREE.BufferGeometry): void => {
  g.userData['surfaced'] = true;
};

/**
 * A piece's looks in each of the 3D views desktop offers: `finished` draws the
 * part's appearance (`RealisticRenderer`), `figure` its figure color
 * (`FigureRenderer`). Both are built with the geometry, so switching views
 * rebuilds nothing.
 */
export interface PieceViews {
  finished: PieceLooks;
  figure: PieceLooks;
}

export type RenderMode = keyof PieceViews;

const nodeLooks = (n: ComponentNode, palette: PartPalette): PieceViews => ({
  finished: partLooks(n, palette),
  figure: figureLooks(n, palette),
});

/** The motor's look. Desktop draws a motor with its maker's texture; here it is the palette color, matte. */
const motorLooks = (palette: PartPalette): PieceViews => {
  const look = { color: palette.motor, shine: 0, opacity: 1 };
  const looks = { outside: look, inside: look, edges: look };
  return { finished: looks, figure: looks };
};

/**
 * Geometries merged into one, each source a group drawn with the surface it is
 * paired with. A missing source (a solid tube has no bore) is left out.
 */
function surfaced(parts: [THREE.BufferGeometry | null, keyof typeof SURFACE][]): THREE.BufferGeometry {
  const present = parts.filter((p): p is [THREE.BufferGeometry, keyof typeof SURFACE] => p[0] !== null);
  const merged = mergeGeometries(
    present.map(([g]) => g),
    true,
  );
  present.forEach(([, surface], i) => {
    merged.groups[i]!.materialIndex = SURFACE[surface];
  });
  markSurfaced(merged);
  return merged;
}

/** A lathe of one run of profile points, or null when there is no run to revolve. */
const lathe = (pts: THREE.Vector2[]): THREE.BufferGeometry | null =>
  pts.length < 2 ? null : new THREE.LatheGeometry(pts, 48);

/** Internal parts drawn as the space they take rather than as a made part:
 *  packed recovery gear and mass objects. `DISC_TYPES` are the made parts. */
const PACKED_TYPES = new Set(['parachute', 'streamer', 'shockcord', 'masscomponent']);

// Axial placement is the shared `position.axialStart`, not a copy: an
// `absolute` child is measured from the nose tip, as the kernel measures it, so
// a second implementation puts an absolutely positioned child in a different
// place in 3D than in 2D.

/** A shoulder: the reduced-diameter stub that plugs into the tube next door. */
interface Shoulder {
  radius: number;
  length: number;
}

/** A node's shoulder under the given key prefix, or undefined when it has none. */
const shoulderOf = (n: ComponentNode, prefix: '' | 'fore' | 'aft'): Shoulder | undefined => {
  // A nose cone has one shoulder and spells it `shoulderRadius`; a transition
  // has two and spells them `foreShoulderRadius` / `aftShoulderRadius`.
  const key = (what: 'Radius' | 'Length') => (prefix ? `${prefix}Shoulder${what}` : `shoulder${what}`);
  const radius = num(n, key('Radius'), 0);
  const length = num(n, key('Length'), 0);
  return radius > 1e-6 && length > 1e-6 ? { radius, length } : undefined;
};

/**
 * Lathe points for a nose/transition outer profile (kernel-exact shapes from
 * shapeProfile.ts). Lathe geometry revolves around +Y; the radius floor keeps
 * the tip from degenerating.
 *
 * Shoulders are part of the profile, not separate pieces: two more points at
 * the stub's radius, exactly the pair `solidMesh` appends for the printed
 * solid, so the 3D model carries the shoulder the 2D schematic draws and the
 * print includes. It sits inside the neighboring tube, where the cutaway
 * shows it.
 */
function lathePoints(
  shape: string,
  param: number | undefined,
  length: number,
  foreR: number,
  aftR: number,
  clipped?: boolean,
  fore?: Shoulder,
  aft?: Shoulder,
): THREE.Vector2[] {
  // `clipped` = the node's stored flag; absent keeps the kernel default
  // (clipped), so the drawn transition matches the geometry the engine flies.
  const profile = outerProfile(shape, param, length, foreR, aftR, undefined, undefined, clipped);
  // Clamped to the body it steps down from: a shoulder wider than its own part
  // is a modeling slip, and revolved it would be a flange standing proud of the
  // airframe rather than a stub inside the next tube.
  if (fore) {
    const r = Math.min(fore.radius, foreR);
    profile.unshift([-fore.length, r], [0, r]);
  }
  if (aft) {
    const r = Math.min(aft.radius, aftR);
    profile.push([length, r], [length + aft.length, r]);
  }
  return profile.map(([x, r]) => new THREE.Vector2(Math.max(0.0001, r), x));
}

/**
 * A tube or ring cross-section revolved about the rocket axis: the rectangle
 * innerR..outerR by 0..length, spanning x = 0..length.
 *
 * Tubes are drawn with their wall rather than as solid cylinders or
 * zero-thickness shells: once the airframe is cut open, a zero-thickness shell
 * has no wall to show, so a section through it reads as a soap bubble, and the
 * bore is where every internal part has to fit.
 *
 * The dimensions come from the same `resolveDisc` the DXF cut sheet and the
 * print solids use. The revolve is the view's own: `solidMesh.ts` builds
 * watertight geometry for printing, and this is the same rectangle at the
 * view's segment count, with no welding or manifold checks.
 */
function annulusGeometry(outerR: number, innerR: number, length: number): THREE.BufferGeometry {
  // A wall at least as thick as the radius leaves no bore. `discSolid` returns
  // null for a bore at or past the outer radius and the part is dropped from a
  // print, which is right for a file nobody can slice and wrong for a view:
  // losing the tube is a worse answer than drawing it solid, so the bore is
  // what gets dropped.
  const bore = innerR > 1e-6 && innerR < outerR - 1e-6 ? innerR : 0;
  const v = (r: number, x: number) => new THREE.Vector2(r, x);
  // The ring's cross-section, walked one way round, a surface per side: the
  // fore end, the outer wall, the aft end, the bore.
  const geo = surfaced([
    [lathe([v(bore, 0), v(outerR, 0)]), 'edges'],
    [lathe([v(outerR, 0), v(outerR, length)]), 'outside'],
    [lathe([v(outerR, length), v(bore, length)]), 'edges'],
    [bore ? lathe([v(bore, length), v(bore, 0)]) : null, 'inside'],
  ]);
  geo.rotateZ(-Math.PI / 2); // lathe axial (+Y) -> rocket axis (+X)
  return geo;
}

/**
 * A nose cone or transition as a shell: the revolved outer profile, the same
 * profile moved in by the wall for the inside, and the rings at its open ends
 * for the edges, as `ComponentRenderer.renderTransition` draws it with the
 * inside offset by `-thickness`. A filled part has no inside, and its ends are
 * discs.
 */
function shellGeometry(outer: THREE.Vector2[], thickness: number, filled: boolean): THREE.BufferGeometry {
  const v = (r: number, x: number) => new THREE.Vector2(r, x);
  const inR = (r: number) => (filled ? 0 : Math.max(0.0001, r - thickness));
  const first = outer[0]!;
  const last = outer[outer.length - 1]!;
  // A ring across the wall at one end, walked the way the tube's ends are. An
  // end that closes to a point (a nose cone's tip) has no edge to draw.
  const ring = (from: THREE.Vector2, to: THREE.Vector2) => (Math.abs(from.x - to.x) > 1e-6 ? lathe([from, to]) : null);
  const geo = surfaced([
    [ring(v(inR(first.x), first.y), first), 'edges'],
    [lathe(outer), 'outside'],
    [ring(last, v(inR(last.x), last.y)), 'edges'],
    [filled || thickness <= 0 ? null : lathe(outer.map((p) => v(inR(p.x), p.y)).reverse()), 'inside'],
  ]);
  return geo;
}

export interface Piece {
  key: string;
  /** Owning component's node id, for two-way selection with the tree/2D. */
  id?: string;
  geometry: THREE.BufferGeometry;
  looks: PieceViews;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** External shell (nose/tube/transition), drawn see-through so mounts and
   *  motors read inside. */
  translucent?: boolean;
  /** Inner tubes: glassier still, so the loaded motor inside them shows
   *  (an opaque mount would hide the motor entirely). */
  innerGlass?: boolean;
}

/** The app's 3D geometry, shared by the 3D view and the flight path view. */
export function buildPieces(
  design: RocketTree,
  motors?: MotorDims,
  palette: PartPalette = DEFAULT_PART_COLORS,
): { pieces: Piece[]; totalLen: number; maxR: number } {
  // A transition end with no radius on record is built as the kernel resolves it.
  const tree = withKernelEnds(design);
  const pieces: Piece[] = [];
  let maxR = 0.005;
  let k = 0;
  // Id of the component currently being emitted: every place()/push tags its
  // pieces with it so clicking a mesh maps back to a tree node (and vice versa).
  let curId: string | undefined;

  // Push a piece. For off-axis assemblies an instance transform `xform` is
  // baked into the geometry (as addFins does), so the flat Piece[] stays
  // position/rotation-free there.
  const place = (
    key: string,
    geometry: THREE.BufferGeometry,
    looks: PieceViews,
    position?: [number, number, number],
    rotation?: [number, number, number],
    xform?: THREE.Matrix4,
    translucent?: boolean | 'glass',
  ) => {
    const flags = {
      translucent: translucent === true || undefined,
      innerGlass: translucent === 'glass' || undefined,
    };
    if (!xform) {
      pieces.push({ key, id: curId, geometry, looks, position, rotation, ...flags });
      return;
    }
    const g = geometry.clone();
    const m = new THREE.Matrix4().copy(xform);
    if (position) m.multiply(new THREE.Matrix4().makeTranslation(position[0], position[1], position[2]));
    if (rotation)
      m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])));
    g.applyMatrix4(m);
    pieces.push({ key, id: curId, geometry: g, looks, ...flags });
  };

  const addFins = (
    child: ComponentNode,
    parent: ComponentNode,
    pStart: number,
    pLen: number,
    pRadius: number,
    xform?: THREE.Matrix4,
  ) => {
    const count = countOf(child, 'finCount', 3);
    const thickness = num(child, 'thickness', FIN_DEFAULTS.thickness);
    // The fin stands on the body radius under its own front
    // (`FinSet.getFinFront`), not on the parent's widest radius.
    const fp: FinParent = finMount(child, parent, pStart) ?? pRadius;
    const R = mountRadius(fp) ?? pRadius;
    // A freeform fin's span reads its parent (`FreeformFinSet.getSpan`).
    const height = finSpan(child, fp);
    const chord = finRootChord(child);
    const start = typeof fp === 'number' ? axialStart(child, chord, pStart, pLen) : pStart + fp.front;
    maxR = Math.max(maxR, R + height);
    // The cant turns each fin about the radial line through the middle of its
    // root (`FinSet.getCantRotation`, a rotate_y, FinSet.java:1783-1791), before
    // the fin's own turn about the axis. three.js's Y rotation is the kernel's
    // rotate_y matrix.
    const cant = finCant(child);
    const mid = start + chord / 2;
    const canted =
      cant === 0
        ? null
        : new THREE.Matrix4()
            .makeTranslation(mid, 0, 0)
            .multiply(new THREE.Matrix4().makeRotationY(cant))
            .multiply(new THREE.Matrix4().makeTranslation(-mid, 0, 0));

    // The outline comes from the one fin-geometry module (tree/finPlanform.ts),
    // so the ellipse is the kernel's half-ellipse, root/height are measured
    // from the same points that are drawn, and the root closes along the
    // parent's own profile (`getFinPointsWithRoot`), in the fin's frame: x from
    // the fin front, y from R.
    const outline = finPointsWithRoot(child, fp) ?? FREEFORM_FALLBACK;
    // A planform needs three points to enclose anything. A degenerate one (a
    // freeform set whose points were cleared) must not reach `outline[0]!`, which
    // throws out of the geometry build and takes the whole view down.
    const first = outline[0];
    if (!first || outline.length < 3) return;

    const shape = new THREE.Shape();
    shape.moveTo(first[0], first[1]);
    for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i]![0], outline[i]![1]);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    geo.translate(0, 0, -thickness / 2);
    // Desktop's left side is the fin's -z face, drawn with the outside look,
    // and the right side the +z face, drawn with the inside one
    // (`FinRenderer.renderFinSet`). The extrusion's first group is both lids,
    // bottom (-z) then top, each half of it; the second is the edges.
    const [lids, sides] = geo.groups;
    if (lids && sides) {
      const half = lids.count / 2;
      geo.clearGroups();
      geo.addGroup(lids.start, half, SURFACE.outside);
      geo.addGroup(lids.start + half, half, SURFACE.inside);
      geo.addGroup(sides.start, sides.count, SURFACE.edges);
      markSurfaced(geo);
    }

    for (const { angle } of ringInstanceOffsets(count, 0, num(child, 'rotation', 0))) {
      // Fin lies in the XY plane, root on the surface (+Y), then rotate about X.
      const g = geo.clone();
      g.translate(start, R, 0);
      if (canted) g.applyMatrix4(canted);
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(angle));
      if (xform) g.applyMatrix4(xform); // off-axis pod instance
      pieces.push({ key: `fin${k++}`, id: child.id, geometry: g, looks: nodeLooks(child, palette) });
    }
    geo.dispose();
  };

  /**
   * `xform` followed by a shift across the rocket axis to `off`: the frame a
   * part's own children are built in, so a child placed against its parent's
   * axis lands on the copy of the parent it belongs to.
   */
  const offsetXform = (off: { y: number; z: number }, xform?: THREE.Matrix4): THREE.Matrix4 | undefined => {
    if (off.y === 0 && off.z === 0) return xform;
    const m = new THREE.Matrix4().makeTranslation(0, off.y, off.z);
    return xform ? new THREE.Matrix4().copy(xform).multiply(m) : m;
  };

  /**
   * Builds `parent`'s children. `pRadius` is the parent's largest radius, which
   * sizes packed parts inside it; `surfaceAt` is the body radius under a
   * station (`bodyRadiusAt`). Lugs, rail buttons, tube fins and fairings can
   * only sit on a body tube (Transition.isCompatible, treeEdit.canHost), where
   * that is the tube's radius; only a freeform fin sits on a cone or
   * transition, where it is the station's.
   */
  const addChildren = (parent: ComponentNode, pStart: number, pLen: number, pRadius: number, xform?: THREE.Matrix4) => {
    /** The parent's outer radius under the rocket-frame station `x`. */
    const surfaceAt = (x: number): number => bodyRadiusAt(parent, x - pStart) ?? pRadius;
    // A part the kernel repeats along the body is built once per copy.
    for (const child of (parent.children ?? []).flatMap(lineInstances)) {
      curId = child.id;
      if (isPlanarFinSet(child.type)) {
        addFins(child, parent, pStart, pLen, pRadius, xform);
      } else if (child.type === 'tubefinset') {
        // Ring of open tubes around the body, each tangent to the surface.
        const count = countOf(child, 'finCount', 6);
        // It stands on the body radius at its own front
        // (`TubeFinSet.getBodyRadius`), which sizes an automatic tube too.
        const len = num(child, 'length', KERNEL_DEFAULTS.tubefinset.length);
        const start = axialStart(child, len, pStart, pLen);
        const R = surfaceAt(start);
        const rt = tubeFinRadius(child, R);
        // A synced tree carries the parent's wall on a tube fin set that states
        // none (autoRadius `parentDerived`), so the literal is the last resort
        // for an unsynced node; the kernel has no wall of its own for the part.
        const wall = Math.min(num(child, 'thickness', 0.0005), rt * 0.45);
        maxR = Math.max(maxR, R + 2 * rt);
        for (const { angle } of ringInstanceOffsets(count, 0, num(child, 'rotation', 0))) {
          // Open tube along the body axis, lifted to the surface (+Y) and spun
          // about X for the ring position.
          const geo = annulusGeometry(rt, Math.max(rt - wall, rt * 0.55), len);
          geo.translate(start, R + rt, 0);
          geo.applyMatrix4(new THREE.Matrix4().makeRotationX(angle));
          if (xform) geo.applyMatrix4(xform);
          pieces.push({ key: `tubefin${k++}`, id: child.id, geometry: geo, looks: nodeLooks(child, palette) });
        }
      } else if (child.type === 'fairing') {
        // External shroud on the +Y surface (radial angle not modeled).
        const len = num(child, 'length', KERNEL_DEFAULTS.fairing.length);
        const wid = num(child, 'width', KERNEL_DEFAULTS.fairing.width);
        const hgt = num(child, 'height', KERNEL_DEFAULTS.fairing.height);
        const start = axialStart(child, len, pStart, pLen);
        const R = surfaceAt(start);
        maxR = Math.max(maxR, R + hgt);
        const geo = new THREE.BoxGeometry(len, hgt, wid);
        place(`fairing${k++}`, geo, nodeLooks(child, palette), [start + len / 2, R + hgt / 2, 0], [0, 0, 0], xform);
      } else if (child.type === 'launchlug') {
        const len = num(child, 'length', KERNEL_DEFAULTS.launchlug.length);
        const r = num(child, 'outerRadius', KERNEL_DEFAULTS.launchlug.outerRadius);
        // Ride around the body at the radial mount angle (kernel default 180°),
        // staying axial. y = R·cosθ, z = R·sinθ, the pod/cluster convention.
        // It stands on the tube's radius: a lug's parent is always a body tube.
        const ang = num(child, 'angleOffset', Math.PI);
        const start = axialStart(child, len, pStart, pLen);
        const rad = surfaceAt(start) + r;
        // A tube, with its wall, so its bore and ends take the inside and edge looks.
        const wall = num(child, 'thickness', KERNEL_DEFAULTS.launchlug.thickness);
        place(
          `lug${k++}`,
          annulusGeometry(r, r - wall, len),
          nodeLooks(child, palette),
          [start, rad * Math.cos(ang), rad * Math.sin(ang)],
          undefined,
          xform,
        );
      } else if (child.type === 'railbutton') {
        // The button the side and aft views draw: as wide as its outer
        // diameter and standing out from the surface by its height, at its
        // radial mount angle (kernel default 180°). The kernel positions it
        // as a 0-long part (RailButton never sets RocketComponent.length)
        // with its instance bounding box one radius either side of that
        // station, so the cylinder is centered on it.
        const { diameter: dia, reach } = railButtonSize(child);
        const ang = num(child, 'angleOffset', Math.PI);
        const station = axialStart(child, 0, pStart, pLen);
        const R = surfaceAt(station);
        const rad = R + reach / 2;
        maxR = Math.max(maxR, R + reach);
        place(
          `button${k++}`,
          new THREE.CylinderGeometry(dia / 2, dia / 2, reach, 16),
          nodeLooks(child, palette),
          [station, rad * Math.cos(ang), rad * Math.sin(ang)],
          [ang, 0, 0],
          xform,
        );
      } else if (child.type === 'innertube') {
        // Motor mount / inner tube, one per cluster position, visible through
        // the translucent shell. A loaded motor seats flush against the
        // mount's aft end (how motors actually load), same as the 2D view.
        const { length: len, radius: r } = innerTubeExtent(child);
        const start = axialStart(child, len, pStart, pLen);
        const motor = child.id ? motors?.[child.id] : undefined;
        for (const off of placementOffsets(child, r)) {
          place(
            `inner${k++}`,
            annulusGeometry(r, r - num(child, 'thickness', COMPONENT_DEFAULTS.innertube.thickness), len),
            nodeLooks(child, palette),
            [start, off.y, off.z],
            undefined,
            xform,
            'glass',
          );
          if (motor) {
            const mR = motor.diameter / 2;
            const mStart = motorSeatStart(child, start, len, motor.length);
            place(
              `motor${k++}`,
              new THREE.CylinderGeometry(mR, mR, motor.length, 32),
              motorLooks(palette),
              [mStart + motor.length / 2, off.y, off.z],
              [0, 0, -Math.PI / 2],
              xform,
            );
          }
        }
        // Its own internal parts (an engine block, a ring) sit in every tube of
        // the cluster, as the kernel places a child once per parent instance.
        for (const off of placementOffsets(child, r)) addChildren(child, start, len, r, offsetXform(off, xform));
      } else if (isAssembly(child.type)) {
        // Off-axis pod / booster: place its whole sub-chain at the instance's
        // radius + angle (the addFins rotate-about-X primitive, lifted from one
        // fin to a mini-rocket). Nested pods compose transforms.
        const podChain = child.children ?? [];
        const podLen = assemblyChainLength(child);
        const podRadius = resolveAssemblyRadius(child, assemblyParentRadius(parent));
        const podStart = axialStart(child, podLen, pStart, pLen);
        const count = countOf(child, 'instanceCount', 2);
        const angleOffset = num(child, 'angleOffset', 0);
        maxR = Math.max(maxR, podRadius + assemblyBoundingRadius(child));
        for (const off of ringInstanceOffsets(count, podRadius, angleOffset)) {
          const m = new THREE.Matrix4()
            .makeRotationX(off.angle)
            .multiply(new THREE.Matrix4().makeTranslation(0, podRadius, 0));
          addChain(podChain, xform ? new THREE.Matrix4().copy(xform).multiply(m) : m, podStart);
        }
      } else if (DISC_TYPES.has(child.type)) {
        // Centering rings, couplers, bulkheads and engine blocks, at the
        // dimensions the DXF cut sheet and the printed solid use: explicit
        // radii, else the enclosing tube's bore, with a ring's own bore taken
        // from the motor mount it centers. `resolveDisc` is that resolution,
        // and it is imported rather than recreated so the part you see and the
        // part you cut cannot drift apart.
        const d = child.id ? resolveDisc(tree, child.id) : null;
        const length = d?.length ?? partLength(child);
        const outerR = d?.outerR ?? 0;
        const start = axialStart(child, length, pStart, pLen);
        const [off] = placementOffsets(child, outerR);
        if (d && d.outerR > 0 && d.length > 0) {
          place(
            `disc${k++}`,
            annulusGeometry(d.outerR, d.innerR, d.length),
            nodeLooks(child, palette),
            [start, off!.y, off!.z],
            undefined,
            xform,
          );
        }
        // A coupler holds internal parts of its own (a bulkhead in an avionics bay).
        addChildren(child, start, length, outerR, offsetXform(off!, xform));
      } else if (PACKED_TYPES.has(child.type)) {
        // Packed recovery gear and mass objects, at the same extent the 2D
        // schematic dashes in (`internalExtent`). A packed size with no value
        // on record is the schematic's fallback box, drawn as a volume; it is
        // never a different size from the one the 2D view shows.
        const { length, radius } = internalExtent(child, pRadius);
        const start = axialStart(child, length, pStart, pLen);
        const [off] = placementOffsets(child, radius);
        if (radius > 0 && length > 0) {
          place(
            `packed${k++}`,
            new THREE.CylinderGeometry(radius, radius, length, 24),
            nodeLooks(child, palette),
            [start + length / 2, off!.y, off!.z],
            [0, 0, -Math.PI / 2],
            xform,
          );
        }
        // A mass component holds internal parts of its own.
        addChildren(child, start, length, radius, offsetXform(off!, xform));
      }
    }
  };

  // Builds an axial nose→tail chain from rocket-frame station `x0`; `xform`
  // (when present) is baked into every piece to place an off-axis pod instance,
  // and only turns and lifts it, so every station stays in the rocket frame an
  // `absolute` child is measured in. Returns the station the chain ends at.
  const addChain = (nodes: ComponentNode[], xform?: THREE.Matrix4, x0 = 0): number => {
    // A revolved profile from station `at`: after rotation.z = -π/2 the lathe's
    // +Y axis points along +X (aft), so a profile running fore→aft lies along
    // the body.
    const placeLathe = (name: string, pts: THREE.Vector2[], n: ComponentNode, at: number) =>
      place(
        name,
        shellGeometry(
          pts,
          num(n, 'thickness', COMPONENT_DEFAULTS[n.type === 'nosecone' ? 'nosecone' : 'transition'].thickness),
          n['filled'] === true,
        ),
        nodeLooks(n, palette),
        [at, 0, 0],
        [0, 0, -Math.PI / 2],
        xform,
        true,
      );
    let x = x0;
    for (const n of nodes) {
      curId = n.id;
      const len = partLength(n);
      if (n.type === 'nosecone') {
        const R = num(n, 'aftRadius', KERNEL_DEFAULTS.nosecone.aftRadius);
        const shapeName = nodeShape(n);
        // A flipped nose cone is a tail cone: its base, and the shoulder on it,
        // are at the fore end.
        const flipped = n['flipped'] === true;
        const ends = profileEnds(n);
        const shoulder = shoulderOf(n, '');
        const pts = lathePoints(
          shapeName,
          numOpt(n, 'shapeParameter'),
          len,
          ends.fore,
          ends.aft,
          undefined,
          flipped ? shoulder : undefined,
          flipped ? undefined : shoulder,
        );
        placeLathe(`nose${k++}`, pts, n, x);
        maxR = Math.max(maxR, R);
        addChildren(n, x, len, R, xform);
        x += len;
      } else if (n.type === 'bodytube') {
        const R = bodyTubeRadius(n);
        // Hollow: the wall the part list already carries, revolved, so a
        // cutaway shows a wall and a bore instead of a solid rod. A filled tube
        // is the solid rod the kernel flies (BodyTube.setFilled), whatever wall
        // thickness it still carries.
        const bore = n['filled'] === true ? 0 : R - num(n, 'thickness', COMPONENT_DEFAULTS.bodytube.thickness);
        place(`body${k++}`, annulusGeometry(R, bore, len), nodeLooks(n, palette), [x, 0, 0], undefined, xform, true);
        maxR = Math.max(maxR, R);
        // Min-diameter mount: a motor loaded directly in this body tube.
        const tubeMotor = n.id ? motors?.[n.id] : undefined;
        if (tubeMotor) {
          const mR = tubeMotor.diameter / 2;
          const mStart = motorSeatStart(n, x, len, tubeMotor.length);
          place(
            `motor${k++}`,
            new THREE.CylinderGeometry(mR, mR, tubeMotor.length, 32),
            motorLooks(palette),
            [mStart + tubeMotor.length / 2, 0, 0],
            [0, 0, -Math.PI / 2],
            xform,
          );
        }
        addChildren(n, x, len, R, xform);
        x += len;
      } else if (n.type === 'transition') {
        const { fore: rf, aft: ra } = profileEnds(n);
        const shapeName = nodeShape(n);
        // Same lathe pattern as the nose: profile y runs fore→aft, and after
        // rotation.z = -π/2 the lathe's +Y axis points along +X (aft).
        // node['clipped'] (.ork <shapeclipped>) rides along so an unclipped
        // file draws the way it simulates.
        const pts = lathePoints(
          shapeName,
          numOpt(n, 'shapeParameter'),
          len,
          rf,
          ra,
          typeof n['clipped'] === 'boolean' ? n['clipped'] : undefined,
          shoulderOf(n, 'fore'),
          shoulderOf(n, 'aft'),
        );
        placeLathe(`trans${k++}`, pts, n, x);
        maxR = Math.max(maxR, rf, ra);
        addChildren(n, x, len, Math.max(rf, ra), xform);
        x += len;
      }
    }
    return x;
  };

  // Stages flatten into one nose-to-tail chain (sustainer first, boosters after).
  const chain = axialChain(tree);
  const totalLen = addChain(chain);

  return { pieces, totalLen: Math.max(totalLen, 0.05), maxR };
}

/** The size rule for the on-axis CG and CP markers; AxisCallout scales its sprite and label from it. */
export const markerRadius = (totalLen: number, maxR: number): number => Math.max(totalLen * 0.015, maxR * 0.35);

/**
 * World-space bounds of the rendered rocket, straight off the Piece list.
 * `Box3.setFromObject(scene)` would also work, but the pieces are what the
 * scene is built from, so this needs no world matrices to be up to date, is
 * deterministic outside a mounted canvas, and leaves out the
 * CG/CP marker spheres (annotations, not rocket). Pieces carrying a bake-in
 * transform already have it applied to their geometry; the rest get their
 * position/rotation applied here as T·R, exactly as <mesh> composes it. A
 * rotated piece contributes the AABB of its rotated box: conservative, so the
 * framing can only ever be roomy, never clipped.
 */
export function piecesBounds(pieces: Piece[]): THREE.Box3 {
  const box = new THREE.Box3();
  const one = new THREE.Box3();
  for (const p of pieces) {
    if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
    if (!p.geometry.boundingBox) continue;
    one.copy(p.geometry.boundingBox);
    if (p.position || p.rotation) {
      const r = p.rotation ?? [0, 0, 0];
      const t = p.position ?? [0, 0, 0];
      one.applyMatrix4(
        new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2])).setPosition(t[0], t[1], t[2]),
      );
    }
    box.union(one);
  }
  return box;
}
