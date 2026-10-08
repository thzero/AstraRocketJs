import * as THREE from 'three';
import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { countOf, num, numOpt } from '../../tree/nodeProps';
import { axialChain, motorSeatStart, partLength } from '../../tree/position';
import { FIN_DEFAULTS, KERNEL_DEFAULTS } from '../../tree/kernelDefaults';
import { FREEFORM_FALLBACK, finPlanformPoints, finRootChord, finSpan } from '../../tree/finPlanform';
import {
  assemblyBoundingRadius,
  assemblyChainLength,
  isAssembly,
  resolveAssemblyRadius,
  ringInstanceOffsets,
} from '../../tree/assembly.js';
import { clusterOffsets } from '../../tree/cluster.js';
import { isPlanarFinSet, tubeFinRadius } from '../../tree/tubefins.js';
import { nodeShape, outerProfile } from '../../tree/shapeProfile.js';
import { colorForType, DEFAULT_PART_COLORS, type PartPalette } from '../../services/design/partColors';
import { COMPONENT_DEFAULTS } from '../../services/design/componentDefaults';
import { DISC_TYPES } from '../../services/files/componentFormats';
import { resolveDisc } from '../../services/design/discGeometry';
import { axialStart, colorOf, innerTubeExtent, internalExtent, type MotorDims } from '../../tree/schematicGeometry';

/**
 * Owns the 3D geometry of the rocket: the component tree to Piece list build
 * (`buildPieces`, shared with the flight path view), the
 * bounds of that list, and the marker size rule the callouts hang off. Pure
 * three.js, no React, so every number here is testable without a canvas.
 * Rocket axis = +X (nose tip at x=0, aft increasing), matching the engine.
 */

// A component's own `color` override, else its group color from the palette.
const nodeColor = (n: ComponentNode, palette: PartPalette): string => colorOf(n, colorForType(n.type, palette));

/** Internal parts drawn as the space they take rather than as a made part:
 *  packed recovery gear and mass objects. `DISC_TYPES` are the made parts. */
const PACKED_TYPES = new Set(['parachute', 'streamer', 'shockcord', 'masscomponent']);

// Axial placement is the shared `schematicGeometry.axialStart`, not a copy: for
// the `absolute` method the 2D view and the kernel add the parent's start to
// `pos.offset`, so a second implementation puts an absolutely positioned child in
// a different place in 3D than in 2D.

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
 * print solids use. The revolve is the view's own because `solidMesh.ts` says
 * in its header that its geometry is built watertight for printing and does
 * not serve the view; this is the same rectangle at the view's segment count,
 * with no welding or manifold checks.
 */
function annulusGeometry(outerR: number, innerR: number, length: number): THREE.BufferGeometry {
  // A wall at least as thick as the radius leaves no bore. `discSolid` returns
  // null there and the part is dropped from a print, which is right for a file
  // nobody can slice and wrong for a view: losing the tube is a worse answer
  // than drawing it solid, so the bore is what gets dropped.
  const bore = innerR > 1e-6 && innerR < outerR - 1e-6 ? innerR : 0;
  const pts = bore
    ? [
        new THREE.Vector2(bore, 0),
        new THREE.Vector2(outerR, 0),
        new THREE.Vector2(outerR, length),
        new THREE.Vector2(bore, length),
        new THREE.Vector2(bore, 0), // close the ring's cross-section
      ]
    : [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(outerR, 0),
        new THREE.Vector2(outerR, length),
        new THREE.Vector2(0, length),
      ];
  const geo = new THREE.LatheGeometry(pts, 48);
  geo.rotateZ(-Math.PI / 2); // lathe axial (+Y) -> rocket axis (+X)
  return geo;
}

export interface Piece {
  key: string;
  /** Owning component's node id, for two-way selection with the tree/2D. */
  id?: string;
  geometry: THREE.BufferGeometry;
  color: string;
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
  tree: RocketTree,
  motors?: MotorDims,
  palette: PartPalette = DEFAULT_PART_COLORS,
): { pieces: Piece[]; totalLen: number; maxR: number } {
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
    color: string,
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
      pieces.push({ key, id: curId, geometry, color, position, rotation, ...flags });
      return;
    }
    const g = geometry.clone();
    const m = new THREE.Matrix4().copy(xform);
    if (position) m.multiply(new THREE.Matrix4().makeTranslation(position[0], position[1], position[2]));
    if (rotation)
      m.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])));
    g.applyMatrix4(m);
    pieces.push({ key, id: curId, geometry: g, color, ...flags });
  };

  const addFins = (child: ComponentNode, pStart: number, pLen: number, pRadius: number, xform?: THREE.Matrix4) => {
    const count = countOf(child, 'finCount', 3);
    const root = finRootChord(child);
    const height = finSpan(child);
    const thickness = num(child, 'thickness', FIN_DEFAULTS.thickness);
    const start = axialStart(child, root, pStart, pLen);
    maxR = Math.max(maxR, pRadius + height);

    // The outline comes from the one fin-geometry module (tree/finPlanform.ts),
    // so the ellipse is the kernel's half-ellipse and root/height are measured
    // from the same points that are drawn.
    const outline = finPlanformPoints(child) ?? FREEFORM_FALLBACK;
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

    for (const { angle } of ringInstanceOffsets(count, 0, num(child, 'rotation', 0))) {
      // Fin lies in the XY plane, root on the surface (+Y), then rotate about X.
      const g = geo.clone();
      g.translate(start, pRadius, 0);
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(angle));
      if (xform) g.applyMatrix4(xform); // off-axis pod instance
      pieces.push({ key: `fin${k++}`, id: child.id, geometry: g, color: nodeColor(child, palette) });
    }
    geo.dispose();
  };

  const addChildren = (parent: ComponentNode, pStart: number, pLen: number, pRadius: number, xform?: THREE.Matrix4) => {
    for (const child of parent.children ?? []) {
      curId = child.id;
      if (isPlanarFinSet(child.type)) {
        addFins(child, pStart, pLen, pRadius, xform);
      } else if (child.type === 'tubefinset') {
        // Ring of open tubes around the body, each tangent to the surface.
        const count = countOf(child, 'finCount', 6);
        const len = num(child, 'length', KERNEL_DEFAULTS.tubefinset.length);
        const rt = tubeFinRadius(child, pRadius);
        const wall = Math.min(num(child, 'thickness', 0.0005), rt * 0.45);
        const start = axialStart(child, len, pStart, pLen);
        maxR = Math.max(maxR, pRadius + 2 * rt);
        for (const { angle } of ringInstanceOffsets(count, 0, num(child, 'rotation', 0))) {
          // Open tube: an annulus extruded along the body axis.
          const ring = new THREE.Shape();
          ring.absarc(0, 0, rt, 0, 2 * Math.PI, false);
          const bore = new THREE.Path();
          bore.absarc(0, 0, Math.max(rt - wall, rt * 0.55), 0, 2 * Math.PI, true);
          ring.holes.push(bore);
          const geo = new THREE.ExtrudeGeometry(ring, { depth: len, bevelEnabled: false, curveSegments: 24 });
          // Extrude runs along +Z; rotate so the tube runs along +X (body axis),
          // then lift to the surface (+Y) and spin about X for the ring position.
          geo.rotateY(Math.PI / 2);
          geo.translate(start, pRadius + rt, 0);
          geo.applyMatrix4(new THREE.Matrix4().makeRotationX(angle));
          if (xform) geo.applyMatrix4(xform);
          pieces.push({ key: `tubefin${k++}`, id: child.id, geometry: geo, color: nodeColor(child, palette) });
        }
      } else if (child.type === 'fairing') {
        // External shroud on the +Y surface (radial angle not modeled).
        const len = num(child, 'length', KERNEL_DEFAULTS.fairing.length);
        const wid = num(child, 'width', KERNEL_DEFAULTS.fairing.width);
        const hgt = num(child, 'height', KERNEL_DEFAULTS.fairing.height);
        const start = axialStart(child, len, pStart, pLen);
        maxR = Math.max(maxR, pRadius + hgt);
        const geo = new THREE.BoxGeometry(len, hgt, wid);
        place(
          `fairing${k++}`,
          geo,
          nodeColor(child, palette),
          [start + len / 2, pRadius + hgt / 2, 0],
          [0, 0, 0],
          xform,
        );
      } else if (child.type === 'launchlug') {
        const len = num(child, 'length', KERNEL_DEFAULTS.launchlug.length);
        const r = num(child, 'outerRadius', KERNEL_DEFAULTS.launchlug.outerRadius);
        // Ride around the body at the radial mount angle (kernel default 180°),
        // staying axial. y = R·cosθ, z = R·sinθ, the pod/cluster convention.
        const ang = num(child, 'angleOffset', Math.PI);
        const rad = pRadius + r;
        const start = axialStart(child, len, pStart, pLen);
        const geo = new THREE.CylinderGeometry(r, r, len, 16);
        place(
          `lug${k++}`,
          geo,
          nodeColor(child, palette),
          [start + len / 2, rad * Math.cos(ang), rad * Math.sin(ang)],
          [0, 0, -Math.PI / 2],
          xform,
        );
      } else if (child.type === 'innertube') {
        // Motor mount / inner tube, one per cluster position, visible through
        // the translucent shell. A loaded motor seats flush against the
        // mount's aft end (how motors actually load), same as the 2D view.
        const { length: len, radius: r } = innerTubeExtent(child);
        const start = axialStart(child, len, pStart, pLen);
        const motor = child.id ? motors?.[child.id] : undefined;
        for (const off of clusterOffsets(
          child['cluster'] as string | undefined,
          r,
          num(child, 'clusterScale', 1),
          num(child, 'clusterRotation', 0),
        )) {
          place(
            `inner${k++}`,
            annulusGeometry(r, r - num(child, 'thickness', COMPONENT_DEFAULTS.innertube.thickness), len),
            nodeColor(child, palette),
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
              palette.motor,
              [mStart + motor.length / 2, off.y, off.z],
              [0, 0, -Math.PI / 2],
              xform,
            );
          }
        }
      } else if (isAssembly(child.type)) {
        // Off-axis pod / booster: place its whole sub-chain at the instance's
        // radius + angle (the addFins rotate-about-X primitive, lifted from one
        // fin to a mini-rocket). Nested pods compose transforms.
        const podChain = child.children ?? [];
        const podLen = assemblyChainLength(child);
        const podRadius = resolveAssemblyRadius(child, pRadius);
        const podStart = axialStart(child, podLen, pStart, pLen);
        const count = countOf(child, 'instanceCount', 2);
        const angleOffset = num(child, 'angleOffset', 0);
        maxR = Math.max(maxR, podRadius + assemblyBoundingRadius(child));
        for (const off of ringInstanceOffsets(count, podRadius, angleOffset)) {
          const m = new THREE.Matrix4()
            .makeRotationX(off.angle)
            .multiply(new THREE.Matrix4().makeTranslation(podStart, podRadius, 0));
          addChain(podChain, xform ? new THREE.Matrix4().copy(xform).multiply(m) : m);
        }
      } else if (DISC_TYPES.has(child.type)) {
        // Centering rings, couplers, bulkheads and engine blocks, at the
        // dimensions the DXF cut sheet and the printed solid use: explicit
        // radii, else the enclosing tube's bore, with a ring's own bore taken
        // from the motor mount it centers. `resolveDisc` is that resolution,
        // and it is imported rather than recreated so the part you see and the
        // part you cut cannot drift apart.
        const d = child.id ? resolveDisc(tree, child.id) : null;
        if (d && d.outerR > 0 && d.length > 0) {
          const start = axialStart(child, d.length, pStart, pLen);
          place(
            `disc${k++}`,
            annulusGeometry(d.outerR, d.innerR, d.length),
            nodeColor(child, palette),
            [start, 0, 0],
            undefined,
            xform,
          );
        }
      } else if (PACKED_TYPES.has(child.type)) {
        // Packed recovery gear and mass objects, at the same extent the 2D
        // schematic dashes in (`internalExtent`). Their packed size only
        // reaches the tree from an imported .ork (the editor has no field for
        // it and the kernel never reads it), so for a design built here this
        // is the schematic's fallback box, drawn as a volume. What matters is
        // that it is never a different invented size from the one the 2D view
        // shows.
        const { length, radius } = internalExtent(child, pRadius);
        if (radius > 0 && length > 0) {
          const start = axialStart(child, length, pStart, pLen);
          place(
            `packed${k++}`,
            new THREE.CylinderGeometry(radius, radius, length, 24),
            nodeColor(child, palette),
            [start + length / 2, 0, 0],
            [0, 0, -Math.PI / 2],
            xform,
          );
        }
      }
      // Rail buttons and the rest stay out of the 3D build.
    }
  };

  // Builds an axial nose→tail chain in its local frame; `xform` (when present)
  // is baked into every piece to place an off-axis pod instance. Returns the
  // chain's axial length.
  const addChain = (nodes: ComponentNode[], xform?: THREE.Matrix4): number => {
    let x = 0;
    for (const n of nodes) {
      curId = n.id;
      const len = partLength(n);
      if (n.type === 'nosecone') {
        const R = num(n, 'aftRadius', KERNEL_DEFAULTS.nosecone.aftRadius);
        const shapeName = nodeShape(n);
        const pts = lathePoints(
          shapeName,
          numOpt(n, 'shapeParameter'),
          len,
          0,
          R,
          undefined,
          undefined,
          shoulderOf(n, ''),
        );
        place(
          `nose${k++}`,
          new THREE.LatheGeometry(pts, 48),
          nodeColor(n, palette),
          [x, 0, 0],
          [0, 0, -Math.PI / 2],
          xform,
          true,
        );
        maxR = Math.max(maxR, R);
        addChildren(n, x, len, R, xform);
        x += len;
      } else if (n.type === 'bodytube') {
        const R = num(n, 'outerRadius', KERNEL_DEFAULTS.bodytube.outerRadius);
        // Hollow: the wall the part list already carries, revolved, so a
        // cutaway shows a wall and a bore instead of a solid rod.
        const wall = num(n, 'thickness', COMPONENT_DEFAULTS.bodytube.thickness);
        place(
          `body${k++}`,
          annulusGeometry(R, R - wall, len),
          nodeColor(n, palette),
          [x, 0, 0],
          undefined,
          xform,
          true,
        );
        maxR = Math.max(maxR, R);
        // Min-diameter mount: a motor loaded directly in this body tube.
        const tubeMotor = n.id ? motors?.[n.id] : undefined;
        if (tubeMotor) {
          const mR = tubeMotor.diameter / 2;
          const mStart = motorSeatStart(n, x, len, tubeMotor.length);
          place(
            `motor${k++}`,
            new THREE.CylinderGeometry(mR, mR, tubeMotor.length, 32),
            palette.motor,
            [mStart + tubeMotor.length / 2, 0, 0],
            [0, 0, -Math.PI / 2],
            xform,
          );
        }
        addChildren(n, x, len, R, xform);
        x += len;
      } else if (n.type === 'transition') {
        const rf = num(n, 'foreRadius', 0.012);
        const ra = num(n, 'aftRadius', 0.009);
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
        place(
          `trans${k++}`,
          new THREE.LatheGeometry(pts, 48),
          nodeColor(n, palette),
          [x, 0, 0],
          [0, 0, -Math.PI / 2],
          xform,
          true,
        );
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

/** One size rule for the on-axis marker spheres and the callout gadget. */
export const markerRadius = (totalLen: number, maxR: number): number => Math.max(totalLen * 0.015, maxR * 0.35);

/**
 * World-space bounds of the rendered rocket, straight off the Piece list.
 * `Box3.setFromObject(scene)` would also work, but the pieces are what the
 * scene is built from, so this needs no world matrices to be up to date, is
 * deterministic outside a mounted canvas (hence testable), and leaves out the
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
