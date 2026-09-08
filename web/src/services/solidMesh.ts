import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ComponentNode } from '../engine/openRocketEngine';
import { num, numOpt } from '../tree/nodeProps';
import { outerProfile } from '../tree/shapeProfile';

/**
 * Build the rocket's external airframe as watertight solids for 3D print / CAD.
 *
 * This does NOT reuse the 3D view's geometry: that is built for looks (open
 * lathe shells, a tip radius floored at 0.1 mm) and leaves non-manifold seams
 * when repaired. Instead each external part is generated as a closed solid of
 * revolution with true radius-0 poles and capped ends, welded so it is manifold
 * by construction. Fins are extruded planform solids seated on the body. The
 * result is metre-scale; {@link meshExport} scales it to millimetres.
 *
 * Scope: nose cones, body tubes, transitions and fin sets — the printable outer
 * mould line. Internal parts (mounts, rings, mass), motors and off-axis pods are
 * not part of the printed shell and are skipped.
 */

const WELD_TOL = 1e-6;
const SEGMENTS = 96;

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** Number of boundary (open) edges — 0 means watertight. Used by tests. */
export function countBoundaryEdges(geo: THREE.BufferGeometry): number {
  const g = geo.index ? geo : mergeVertices(geo);
  const idx = g.getIndex();
  if (!idx) return 0;
  const count = new Map<string, number>();
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const k = edgeKey(u, v);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  let boundary = 0;
  for (const c of count.values()) if (c !== 2) boundary++;
  return boundary;
}

/** Weld coincident vertices and cap every open boundary loop. */
export function makeWatertight(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  // Weld first: display primitives duplicate the seam/pole vertices, so an edge
  // that is geometrically shared is only recognised as shared after welding.
  const g = mergeVertices(geo.index ? geo : mergeVertices(geo), WELD_TOL);
  const idx = g.getIndex();
  const posAttr = g.getAttribute('position');
  if (!idx || !posAttr) return g;

  // Directed boundary edges: an undirected edge used by exactly one triangle.
  // Keep the direction it had in that triangle so the caps can be wound to match.
  const undirected = new Map<string, number>();
  const directed = new Map<number, number>(); // a -> b for boundary edges
  const dirList: Array<[number, number]> = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      undirected.set(edgeKey(u, v), (undirected.get(edgeKey(u, v)) ?? 0) + 1);
      dirList.push([u, v]);
    }
  }
  for (const [u, v] of dirList) {
    if (undirected.get(edgeKey(u, v)) === 1) directed.set(u, v);
  }
  if (directed.size === 0) return g; // already watertight

  const positions: number[] = Array.from(posAttr.array as ArrayLike<number>);
  const indices: number[] = Array.from({ length: idx.count }, (_, i) => idx.getX(i));
  const vec = (i: number) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);

  // Walk the directed boundary edges into closed loops and fan-cap each.
  const visited = new Set<number>();
  for (const [startFrom] of directed) {
    if (visited.has(startFrom)) continue;
    const loop: number[] = [];
    let cur: number | undefined = startFrom;
    let guard = 0;
    while (cur !== undefined && !visited.has(cur) && guard++ < directed.size + 1) {
      visited.add(cur);
      loop.push(cur);
      cur = directed.get(cur);
    }
    if (loop.length < 3) continue;

    // Centroid vertex, then a fan. Winding (centroid, v[i+1], v[i]) opposes the
    // boundary direction so the cap's outward face agrees with the shell it closes.
    const centroid = new THREE.Vector3();
    for (const v of loop) centroid.add(vec(v));
    centroid.multiplyScalar(1 / loop.length);
    const cIdx = positions.length / 3;
    positions.push(centroid.x, centroid.y, centroid.z);
    for (let i = 0; i < loop.length; i++) {
      const v0 = loop[i], v1 = loop[(i + 1) % loop.length];
      indices.push(cIdx, v1, v0);
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setIndex(indices);
  out.computeVertexNormals();
  return out;
}

/**
 * Drop zero-area triangles. A lathe's radius-0 pole is a whole ring of
 * coincident vertices, so its adjacent band is degenerate (tip-to-tip edges);
 * once welded those triangles have no area and, left in, read as non-manifold.
 * Removing them turns the pole into a clean triangle fan.
 */
function dropDegenerate(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = geo.getIndex();
  const pos = geo.getAttribute('position');
  if (!idx) return geo;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const keep: number[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const ia = idx.getX(i), ib = idx.getX(i + 1), ic = idx.getX(i + 2);
    a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
    const area = b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
    if (area > 1e-12) keep.push(ia, ib, ic);
  }
  geo.setIndex(keep);
  return geo;
}

/**
 * Revolve an axial profile into a closed solid, laid along +X and welded.
 * `surface` is [axial (0..len), radius]; radius-0 ends become poles, non-zero
 * ends are capped back to the axis so the body is solid and watertight.
 */
function revolveSolidX(surface: [number, number][], axialOffset: number): THREE.BufferGeometry {
  const n = surface.length;
  const pts: THREE.Vector2[] = [];
  if (surface[0][1] > 1e-9) pts.push(new THREE.Vector2(0, surface[0][0])); // fore cap to axis
  for (const [ax, r] of surface) pts.push(new THREE.Vector2(Math.max(0, r), ax));
  if (surface[n - 1][1] > 1e-9) pts.push(new THREE.Vector2(0, surface[n - 1][0])); // aft cap to axis
  let geo: THREE.BufferGeometry = new THREE.LatheGeometry(pts, SEGMENTS);
  // mergeVertices compares ALL attributes, and a lathe's revolution seam and its
  // radius-0 poles carry different uv/normal at the same position — so they only
  // weld once uv/normal are dropped, leaving a manifold solid welded by position.
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = dropDegenerate(mergeVertices(geo, WELD_TOL));
  geo.rotateZ(-Math.PI / 2); // lathe axial (Y) -> world X
  geo.translate(axialOffset, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A disc / ring / short-tube solid along +X: outer radius `outerR`, optional
 * concentric bore `innerR`, axial length `length`. With no bore it is a solid
 * cylinder (a bulkhead); with a bore it is a hollow annulus (a centring ring or
 * coupler) — a closed rectangular cross-section revolved, so it stays watertight
 * without capping onto the axis.
 */
export function discSolid(outerR: number, innerR: number, length: number): THREE.BufferGeometry {
  const len = length > 1e-6 ? length : 0.002;
  const hasBore = innerR > 1e-6 && innerR < outerR - 1e-6;
  const pts = hasBore
    ? [
        new THREE.Vector2(innerR, 0),
        new THREE.Vector2(outerR, 0),
        new THREE.Vector2(outerR, len),
        new THREE.Vector2(innerR, len),
        new THREE.Vector2(innerR, 0), // close the ring's cross-section
      ]
    : [new THREE.Vector2(0, 0), new THREE.Vector2(outerR, 0), new THREE.Vector2(outerR, len), new THREE.Vector2(0, len)];
  let geo: THREE.BufferGeometry = new THREE.LatheGeometry(pts, SEGMENTS);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo = dropDegenerate(mergeVertices(geo, WELD_TOL));
  geo.rotateZ(-Math.PI / 2); // lathe axial (Y) -> world X
  geo.computeVertexNormals();
  return geo;
}

/** One fin as a flat, watertight extruded solid at the origin (planform in XY,
 *  thickness centred on Z) — ready to lay on a print bed. */
function oneFinSolid(child: ComponentNode): THREE.BufferGeometry {
  const ff = child.type === 'freeformfinset' ? ((child['points'] as [number, number][] | undefined) ?? []) : [];
  const root = child.type === 'freeformfinset' && ff.length ? Math.max(...ff.map((p) => p[0])) : num(child, 'rootChord', 0.05);
  const height = child.type === 'freeformfinset' && ff.length ? Math.max(...ff.map((p) => p[1])) : num(child, 'height', 0.03);
  const thickness = num(child, 'thickness', 0.003);

  const shape = new THREE.Shape();
  if (child.type === 'freeformfinset') {
    const raw = ff.length ? ff : ([[0, 0], [0.02, 0.03], [0.05, 0]] as [number, number][]);
    shape.moveTo(raw[0][0], raw[0][1]);
    for (let i = 1; i < raw.length; i++) shape.lineTo(raw[i][0], raw[i][1]);
  } else if (child.type === 'ellipticalfinset') {
    shape.moveTo(0, 0);
    const steps = 32;
    for (let i = 1; i <= steps; i++) shape.lineTo(root * (i / steps), height * Math.sin(Math.PI * (i / steps)));
    shape.lineTo(root, 0);
  } else {
    const tip = num(child, 'tipChord', 0.03);
    const sweep = num(child, 'sweep', 0.02);
    shape.moveTo(0, 0);
    shape.lineTo(sweep, height);
    shape.lineTo(sweep + tip, height);
    shape.lineTo(root, 0);
  }
  shape.closePath();

  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const welded = dropDegenerate(mergeVertices(g, WELD_TOL));
  welded.computeVertexNormals();
  return welded;
}

/**
 * The watertight solid (metres) for a single component, or null when the type
 * has no 3D-printable body. One part, built at the origin — this backs the
 * per-component STL/OBJ/GLB export.
 */
export function solidForNode(node: ComponentNode): THREE.BufferGeometry | null {
  const len = num(node, 'length', 0);
  switch (node.type) {
    case 'nosecone': {
      const R = num(node, 'aftRadius', 0.012);
      const shape = typeof node['shape'] === 'string' ? (node['shape'] as string) : 'ogive';
      const surface = outerProfile(shape, numOpt(node, 'shapeParameter'), len, 0, R, SEGMENTS);
      // Aft shoulder: a smaller-radius stub that plugs into the body tube.
      const shR = num(node, 'shoulderRadius', 0);
      const shLen = num(node, 'shoulderLength', 0);
      if (shR > 1e-6 && shLen > 1e-6) surface.push([len, Math.min(shR, R)], [len + shLen, Math.min(shR, R)]);
      return revolveSolidX(surface, 0);
    }
    case 'transition': {
      const rf = num(node, 'foreRadius', 0.012);
      const ra = num(node, 'aftRadius', 0.009);
      const shape = typeof node['shape'] === 'string' ? (node['shape'] as string) : 'conical';
      const clipped = typeof node['clipped'] === 'boolean' ? (node['clipped'] as boolean) : undefined;
      let surface = outerProfile(shape, numOpt(node, 'shapeParameter'), len, rf, ra, SEGMENTS, undefined, clipped);
      // Fore/aft shoulders: stubs that plug into the tubes on either side.
      const fShR = num(node, 'foreShoulderRadius', 0), fShLen = num(node, 'foreShoulderLength', 0);
      const aShR = num(node, 'aftShoulderRadius', 0), aShLen = num(node, 'aftShoulderLength', 0);
      if (fShR > 1e-6 && fShLen > 1e-6) surface = [[-fShLen, Math.min(fShR, rf)], [0, Math.min(fShR, rf)], ...surface];
      if (aShR > 1e-6 && aShLen > 1e-6) surface = [...surface, [len, Math.min(aShR, ra)], [len + aShLen, Math.min(aShR, ra)]];
      return revolveSolidX(surface, 0);
    }
    // Tubes — hollow, with their own wall thickness. (Coupler/engine block/rings
    // fit their parent's bore, so they go through resolveDisc, not here.)
    case 'bodytube':
    case 'innertube':
    case 'launchlug':
    case 'tubefinset': {
      const R = num(node, 'outerRadius', 0.012);
      const wall = num(node, 'thickness', node.type === 'launchlug' ? 0.0003 : 0.0005);
      return discSolid(R, Math.max(0, R - wall), len);
    }
    case 'trapezoidfinset':
    case 'ellipticalfinset':
    case 'freeformfinset':
      return oneFinSolid(node);
    default:
      return null;
  }
}
