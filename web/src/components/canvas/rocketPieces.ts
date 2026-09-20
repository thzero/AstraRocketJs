import * as THREE from 'three';
import type { ComponentNode, RocketTree } from '../../engine/openRocketEngine';
import { countOf, num, numOpt } from '../../tree/nodeProps';
import { FREEFORM_FALLBACK, finPlanformPoints, finRootChord, finSpan } from '../../tree/finPlanform';
import {
  assemblyBoundingRadius,
  assemblyChainLength,
  isAssembly,
  resolveAssemblyRadius,
  ringInstanceOffsets,
} from '../../tree/assembly.js';
import { clusterOffsets } from '../../tree/cluster.js';
import { tubeFinRadius } from '../../tree/tubefins.js';
import { outerProfile } from '../../tree/shapeProfile.js';
import { colorForType, DEFAULT_PART_COLORS, type PartPalette } from '../../services/partColors';
import { axialStart, colorOf, type MotorDims } from './schematicGeometry';

/**
 * Owns the 3D geometry of the rocket: the component tree to Piece list build
 * (`buildPieces`, shared with the OBJ exporter and the flight path view), the
 * bounds of that list, and the marker size rule the callouts hang off. Pure
 * three.js, no React, so every number here is testable without a canvas.
 * Rocket axis = +X (nose tip at x=0, aft increasing), matching the engine.
 */

// A component's own `color` override, else its group color from the palette.
const nodeColor = (n: ComponentNode, palette: PartPalette): string => colorOf(n, colorForType(n.type, palette));

// Axial placement is the shared `schematicGeometry.axialStart`. A private copy
// used to live here and had drifted: it returned a bare `pos.offset` for the
// `absolute` method where the 2D view (and the kernel) add the parent's start,
// so an absolutely positioned child sat in a different place in 3D than in 2D.

/**
 * Lathe points for a nose/transition outer profile (kernel-exact shapes from
 * shapeProfile.ts). Lathe geometry revolves around +Y; the radius floor keeps
 * the tip from degenerating.
 */
function lathePoints(
  shape: string,
  param: number | undefined,
  length: number,
  foreR: number,
  aftR: number,
  clipped?: boolean,
): THREE.Vector2[] {
  // `clipped` = the node's stored flag; absent keeps the kernel default
  // (clipped), so the drawn transition matches the geometry the engine flies.
  return outerProfile(shape, param, length, foreR, aftR, undefined, undefined, clipped).map(
    ([x, r]) => new THREE.Vector2(Math.max(0.0001, r), x),
  );
}

export interface Piece {
  key: string;
  /** Owning component's node id — for two-way selection with the tree/2D. */
  id?: string;
  geometry: THREE.BufferGeometry;
  color: string;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** External shell (nose/tube/transition) — drawn see-through so mounts and
   *  motors read inside (S5, 2026-08-21c). */
  translucent?: boolean;
  /** Inner tubes — glassier still, so the loaded motor INSIDE them shows
   *  (batch 08-21d: an opaque mount hid the motor entirely). */
  innerGlass?: boolean;
}

/** Shared with the OBJ exporter — this IS the app's 3D geometry. */
export function buildPieces(
  tree: RocketTree,
  motors?: MotorDims,
  palette: PartPalette = DEFAULT_PART_COLORS,
): { pieces: Piece[]; totalLen: number; maxR: number } {
  const pieces: Piece[] = [];
  let maxR = 0.005;
  let k = 0;
  // Id of the component currently being emitted — every place()/push tags its
  // pieces with it so clicking a mesh maps back to a tree node (and vice versa).
  let curId: string | undefined;

  // Push a piece. For off-axis assemblies an instance transform `xform` is
  // baked into the geometry (like addFins already does), so the flat Piece[]
  // stays position/rotation-free there and the OBJ exporter needs no changes.
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
    const thickness = num(child, 'thickness', 0.003);
    const start = axialStart(child, root, pStart, pLen);
    maxR = Math.max(maxR, pRadius + height);

    // The outline comes from the ONE fin-geometry module (tree/finPlanform.ts).
    // Two bugs lived here: the elliptical branch sampled a sine arch rather than
    // the kernel's half-ellipse, and the freeform branch measured root/height
    // from the NORMALIZED points while drawing the RAW ones, so a fin whose
    // outline began at x = 20 mm was rendered 20 mm aft of where it is mounted.
    const outline = finPlanformPoints(child) ?? FREEFORM_FALLBACK;
    // A planform needs three points to enclose anything; a degenerate one (a
    // freeform set whose points were cleared) used to reach `outline[0]!` and
    // throw out of the geometry build, taking the whole view down.
    const first = outline[0];
    if (!first || outline.length < 3) return;

    const shape = new THREE.Shape();
    shape.moveTo(first[0], first[1]);
    for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i]![0], outline[i]![1]);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    geo.translate(0, 0, -thickness / 2);

    for (let i = 0; i < count; i++) {
      const angle = num(child, 'rotation', 0) + (2 * Math.PI * i) / count;
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
      if (child.type === 'trapezoidfinset' || child.type === 'ellipticalfinset' || child.type === 'freeformfinset') {
        addFins(child, pStart, pLen, pRadius, xform);
      } else if (child.type === 'tubefinset') {
        // Ring of open tubes around the body, each tangent to the surface.
        const count = countOf(child, 'finCount', 6);
        const len = num(child, 'length', 0.1);
        const rt = tubeFinRadius(child, pRadius);
        const wall = Math.min(num(child, 'thickness', 0.0005), rt * 0.45);
        const start = axialStart(child, len, pStart, pLen);
        maxR = Math.max(maxR, pRadius + 2 * rt);
        for (let i = 0; i < count; i++) {
          const angle = num(child, 'rotation', 0) + (2 * Math.PI * i) / count;
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
        const len = num(child, 'length', 0.08);
        const wid = num(child, 'width', 0.025);
        const hgt = num(child, 'height', 0.02);
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
        const len = num(child, 'length', 0.05);
        const r = num(child, 'outerRadius', 0.0022);
        // Ride around the body at the radial mount angle (kernel default 180°),
        // staying axial. y = R·cosθ, z = R·sinθ — the pod/cluster convention.
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
        // Motor mount / inner tube, one per cluster position — visible through
        // the translucent shell. A loaded motor seats flush against the
        // mount's aft end (how motors actually load), same as the 2D view.
        const len = num(child, 'length', 0.05);
        const r = num(child, 'outerRadius', 0.0095);
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
            new THREE.CylinderGeometry(r, r, len, 32),
            nodeColor(child, palette),
            [start + len / 2, off.y, off.z],
            [0, 0, -Math.PI / 2],
            xform,
            'glass',
          );
          if (motor) {
            const mR = motor.diameter / 2;
            const mStart = start + len - motor.length + num(child, 'motorOverhang', 0);
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
      }
      // Other internal components are not rendered in 3D (invisible in tubes).
    }
  };

  // Builds an axial nose→tail chain in its local frame; `xform` (when present)
  // is baked into every piece to place an off-axis pod instance. Returns the
  // chain's axial length.
  const addChain = (nodes: ComponentNode[], xform?: THREE.Matrix4): number => {
    let x = 0;
    for (const n of nodes) {
      curId = n.id;
      const len = num(n, 'length', 0);
      if (n.type === 'nosecone') {
        const R = num(n, 'aftRadius', 0.012);
        const shapeName = typeof n['shape'] === 'string' ? (n['shape'] as string) : 'ogive';
        const pts = lathePoints(shapeName, numOpt(n, 'shapeParameter'), len, 0, R);
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
        const R = num(n, 'outerRadius', 0.012);
        place(
          `body${k++}`,
          new THREE.CylinderGeometry(R, R, len, 48),
          nodeColor(n, palette),
          [x + len / 2, 0, 0],
          [0, 0, -Math.PI / 2],
          xform,
          true,
        );
        maxR = Math.max(maxR, R);
        // Min-diameter mount: a motor loaded directly in this body tube.
        const tubeMotor = n.id ? motors?.[n.id] : undefined;
        if (tubeMotor) {
          const mR = tubeMotor.diameter / 2;
          const mStart = x + len - tubeMotor.length + num(n, 'motorOverhang', 0);
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
        const shapeName = typeof n['shape'] === 'string' ? (n['shape'] as string) : 'conical';
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
          typeof n['clipped'] === 'boolean' ? (n['clipped'] as boolean) : undefined,
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
  const chain = tree.components.flatMap((n) => (n.type === 'stage' ? (n.children ?? []) : [n]));
  const totalLen = addChain(chain);

  return { pieces, totalLen: Math.max(totalLen, 0.05), maxR };
}

/** One size rule for the on-axis marker spheres AND the callout gadget. */
export const markerRadius = (totalLen: number, maxR: number): number => Math.max(totalLen * 0.015, maxR * 0.35);

/**
 * World-space bounds of the rendered rocket, straight off the Piece list.
 * `Box3.setFromObject(scene)` would also work, but the pieces ARE what the
 * scene is built from, so this needs no world matrices to be up to date, is
 * deterministic outside a mounted canvas (hence testable), and leaves out the
 * CG/CP marker spheres — annotations, not rocket. Pieces carrying a bake-in
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
