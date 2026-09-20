import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ComponentNode } from '../engine/openRocketEngine';
import { num, numOpt } from '../tree/nodeProps';
import { finCutContour, finRootChord, finSpan } from '../tree/finPlanform';
import { freeformPoints } from '../tree/position';
import { outerProfile } from '../tree/shapeProfile';
import { tubeFinRadius } from '../tree/tubefins';
import { meshTolerances, validateSolid } from './meshValidate';

/**
 * Build the rocket's external airframe as watertight solids for 3D print / CAD.
 *
 * This does NOT reuse the 3D view's geometry: that is built for looks (open
 * lathe shells, a tip radius floored at 0.1 mm) and leaves non-manifold seams
 * when repaired. Instead each external part is generated as a closed solid of
 * revolution with true radius-0 poles and capped ends, welded so it is manifold
 * by construction. Fins are extruded planform solids seated on the body. The
 * result is meter-scale; {@link meshExport} scales it to millimeters.
 *
 * Scope: nose cones, body tubes, transitions and fin sets — the printable outer
 * mould line. Internal parts (mounts, rings, mass), motors and off-axis pods are
 * not part of the printed shell and are skipped.
 */

// Weld and degeneracy tolerances are derived per-geometry from its own
// bounding box (see meshTolerances): a fixed absolute cut erased every
// triangle of a heavily scaled-down design and still reported success.
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
    const a = idx.getX(i),
      b = idx.getX(i + 1),
      c = idx.getX(i + 2);
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
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
  // that is geometrically shared is only recognized as shared after welding.
  const g = mergeVertices(geo.index ? geo : mergeVertices(geo), meshTolerances(geo).weld);
  const idx = g.getIndex();
  const posAttr = g.getAttribute('position');
  if (!idx || !posAttr) return g;

  // Directed boundary edges (a→b): an undirected edge used by exactly one
  // triangle, keeping the direction it had there so the caps wind to match.
  const undirected = new Map<string, number>();
  const dirList: Array<[number, number]> = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i),
      b = idx.getX(i + 1),
      c = idx.getX(i + 2);
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const k = edgeKey(u, v);
      undirected.set(k, (undirected.get(k) ?? 0) + 1);
      dirList.push([u, v]);
    }
  }
  // Successors keyed by START vertex, as a MULTIMAP. A vertex where two boundary
  // loops meet (a self-touching planform, a figure-8 seam) is the start of more
  // than one boundary edge; a plain Map<number,number> kept only the last and
  // left the other loop uncapped, so the "watertight" result was not. Each edge
  // is consumed exactly once by the walk below.
  const outgoing = new Map<number, number[]>();
  let boundaryEdges = 0;
  for (const [u, v] of dirList) {
    if (undirected.get(edgeKey(u, v)) === 1) {
      const arr = outgoing.get(u);
      if (arr) arr.push(v);
      else outgoing.set(u, [v]);
      boundaryEdges++;
    }
  }
  if (boundaryEdges === 0) return g; // already watertight

  const positions: number[] = Array.from(posAttr.array as ArrayLike<number>);
  const indices: number[] = Array.from({ length: idx.count }, (_, i) => idx.getX(i));
  const vec = (i: number) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);

  /**
   * Close one boundary loop with a proper triangulation of its own plane.
   *
   * Returns false when the loop is degenerate (collinear, or nothing the ear
   * clipper can resolve). The caller does not need to react: the final
   * countBoundaryEdges check below still fails the export, which is the honest
   * outcome for a shell that cannot be closed.
   */
  const capLoop = (loop: number[]): boolean => {
    const pts = loop.map(vec);
    // Newell normal: correct for a loop that is neither planar nor convex.
    const n = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!,
        q = pts[(i + 1) % pts.length]!;
      n.x += (p.y - q.y) * (p.z + q.z);
      n.y += (p.z - q.z) * (p.x + q.x);
      n.z += (p.x - q.x) * (p.y + q.y);
    }
    if (n.lengthSq() === 0) return false;
    n.normalize();
    // An orthonormal basis on that plane, so the loop can be ear-clipped in 2D.
    const u = new THREE.Vector3(1, 0, 0);
    if (Math.abs(n.dot(u)) > 0.9) u.set(0, 1, 0);
    u.crossVectors(u, n).normalize();
    const v = new THREE.Vector3().crossVectors(n, u);
    const flat = pts.map((p) => new THREE.Vector2(p.dot(u), p.dot(v)));
    const fanned = THREE.ShapeUtils.triangulateShape(flat, []);
    if (!fanned.length) return false;
    const e1 = new THREE.Vector3(),
      e2 = new THREE.Vector3(),
      tn = new THREE.Vector3();
    for (const t of fanned) {
      const i0 = loop[t[0]!]!,
        i1 = loop[t[1]!]!,
        i2 = loop[t[2]!]!;
      // The shell traverses each boundary edge one way, so the cap has to
      // traverse it the other: every cap triangle faces -n, against the loop's
      // own direction. Checked per triangle rather than assumed, so the cap
      // does not depend on which orientation the ear clipper hands back.
      tn.crossVectors(e1.subVectors(vec(i1), vec(i0)), e2.subVectors(vec(i2), vec(i0)));
      if (tn.dot(n) > 0) indices.push(i0, i2, i1);
      else indices.push(i0, i1, i2);
    }
    return true;
  };

  // Consume one outgoing boundary edge from `u` (undefined when none remain).
  const step = (u: number): number | undefined => outgoing.get(u)?.pop();

  // Walk the boundary into CLOSED loops and fan-cap each. Starting a fresh loop
  // from every vertex that still has an unconsumed edge handles multiple loops
  // sharing a vertex; `boundaryEdges` bounds the total work.
  const push = (u: number, v: number) => {
    const arr = outgoing.get(u);
    if (arr) arr.push(v);
    else outgoing.set(u, [v]);
  };

  for (const start of outgoing.keys()) {
    while ((outgoing.get(start)?.length ?? 0) > 0) {
      const loop: number[] = [start];
      // Every edge this attempt consumes, so a failed walk can put them back.
      // `step` POPS, and the old code just `continue`d on failure — those edges
      // were gone for good, the boundary they belonged to was never capped, and
      // makeWatertight still returned normally. meshExport then labeled the
      // result watertight and handed someone an STL with a hole in it.
      const eaten: Array<[number, number]> = [];
      const take = (u: number): number | undefined => {
        const v = step(u);
        if (v !== undefined) eaten.push([u, v]);
        return v;
      };
      let cur = take(start);
      let closed = false;
      let guard = 0;
      while (cur !== undefined && guard++ <= boundaryEdges) {
        if (cur === start) {
          closed = true;
          break;
        }
        loop.push(cur);
        cur = take(cur);
      }
      if (!closed || loop.length < 3) {
        for (const [u, v] of eaten) push(u, v);
        // …and stop retrying from THIS vertex: the edges are back, so the outer
        // condition still holds and we would walk the same dead end forever.
        // Another start vertex may yet close a loop through them.
        break;
      }

      // Ear-clip the loop rather than fanning it from a new apex vertex.
      //
      // The fan used the arithmetic MEAN of the loop's vertices, which is not
      // the polygon's centroid: for a non-convex loop it can fall outside the
      // loop entirely, and the fan then emits overlapping triangles facing
      // opposite ways. Nothing noticed, because a fan uses every edge exactly
      // twice and that is the only question countBoundaryEdges asks. The
      // winding check in validateSolid is what catches it now.
      capLoop(loop);
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setIndex(indices);
  out.computeVertexNormals();
  // The function's whole contract. A boundary the walk could not resolve now
  // fails the export (store.exportComponent catches and shows it) instead of
  // shipping a hole to a slicer, where it surfaces as a part that prints wrong.
  const left = countBoundaryEdges(out);
  if (left > 0) {
    throw new Error(`Could not close this solid: ${left} open edge(s) remain after capping.`);
  }
  return out;
}

/**
 * Do these two closed segments properly cross (sharing an endpoint doesn't
 * count)? Collinear overlap is deliberately not treated as a crossing — a
 * doubled-back edge is degenerate, not a bow tie, and `mergeVertices` folds it.
 */
function segmentsCross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const cross = (ox: number, oy: number, px: number, py: number) => ox * py - oy * px;
  const d1 = cross(d[0] - c[0], d[1] - c[1], a[0] - c[0], a[1] - c[1]);
  const d2 = cross(d[0] - c[0], d[1] - c[1], b[0] - c[0], b[1] - c[1]);
  const d3 = cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]);
  const d4 = cross(b[0] - a[0], b[1] - a[1], d[0] - a[0], d[1] - a[1]);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  // TOUCHING counts too. With strict inequalities alone, a vertex sitting
  // exactly ON a non-adjacent edge - or two non-adjacent vertices dragged onto
  // each other in FreeformFinEditor - was not a crossing, so a figure-8
  // outline passed isSimplePolygon and extruded into a pinch point where four
  // shell faces meet at one vertex. Non-manifold, and no slicer's problem to
  // guess at.
  const within = (p: [number, number], q: [number, number], r: [number, number]) =>
    Math.min(p[0], r[0]) <= q[0] &&
    q[0] <= Math.max(p[0], r[0]) &&
    Math.min(p[1], r[1]) <= q[1] &&
    q[1] <= Math.max(p[1], r[1]);
  if (d1 === 0 && within(c, a, d)) return true;
  if (d2 === 0 && within(c, b, d)) return true;
  if (d3 === 0 && within(a, c, b)) return true;
  if (d4 === 0 && within(a, d, b)) return true;
  return false;
}

/**
 * Is this closed outline a SIMPLE polygon — no edge crossing any non-adjacent
 * edge?
 *
 * FreeformFinEditor happily lets a vertex be dragged through the opposite edge,
 * and a bow-tie planform extrudes into a self-intersecting solid that no slicer
 * can make sense of. O(n²), which is nothing at fin-outline sizes.
 */
export function isSimplePolygon(pts: [number, number][]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  // Two vertices at the same point pinch the outline even when no pair of
  // EDGES crosses. Caught explicitly rather than left to the collinear cases
  // below, which depend on exact floating-point zeros.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (pts[i]![0] === pts[j]![0] && pts[i]![1] === pts[j]![1]) return false;
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent: shares an endpoint
      if (segmentsCross(pts[i]!, pts[(i + 1) % n]!, pts[j]!, pts[(j + 1) % n]!)) return false;
    }
  }
  return true;
}

/**
 * Drop zero-area triangles. A lathe's radius-0 pole is a whole ring of
 * coincident vertices, so its adjacent band is degenerate (tip-to-tip edges);
 * once welded those triangles have no area and, left in, read as non-manifold.
 * Removing them turns the pole into a clean triangle fan.
 */
function dropDegenerate(geo: THREE.BufferGeometry, areaTol = 1e-12): THREE.BufferGeometry {
  const idx = geo.getIndex();
  const pos = geo.getAttribute('position');
  if (!idx) return geo;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const keep: number[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    const ia = idx.getX(i),
      ib = idx.getX(i + 1),
      ic = idx.getX(i + 2);
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    const area = b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5;
    if (area > areaTol) keep.push(ia, ib, ic);
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
  if (n === 0) return new THREE.BufferGeometry(); // nothing to revolve (guards surface[0] below)
  const pts: THREE.Vector2[] = [];
  if (surface[0]![1] > 1e-9) pts.push(new THREE.Vector2(0, surface[0]![0])); // fore cap to axis
  for (const [ax, r] of surface) pts.push(new THREE.Vector2(Math.max(0, r), ax));
  if (surface[n - 1]![1] > 1e-9) pts.push(new THREE.Vector2(0, surface[n - 1]![0])); // aft cap to axis
  let geo: THREE.BufferGeometry = new THREE.LatheGeometry(pts, SEGMENTS);
  // mergeVertices compares ALL attributes, and a lathe's revolution seam and its
  // radius-0 poles carry different uv/normal at the same position — so they only
  // weld once uv/normal are dropped, leaving a manifold solid welded by position.
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const tol = meshTolerances(geo);
  geo = dropDegenerate(mergeVertices(geo, tol.weld), tol.area);
  geo.rotateZ(-Math.PI / 2); // lathe axial (Y) -> world X
  geo.translate(axialOffset, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A disc / ring / short-tube solid along +X: outer radius `outerR`, optional
 * concentric bore `innerR`, axial length `length`. With no bore it is a solid
 * cylinder (a bulkhead); with a bore it is a hollow annulus (a centering ring or
 * coupler) — a closed rectangular cross-section revolved, so it stays watertight
 * without capping onto the axis.
 */
export function discSolid(outerR: number, innerR: number, length: number): THREE.BufferGeometry | null {
  const len = length > 1e-6 ? length : 0.002;
  // An INVERTED ring (ID >= OD — reachable from a malformed .ork or a bad
  // catalog row) used to fall through to the solid-cylinder branch and export a
  // centering ring as a solid disc. Printed, that blocks the motor tube, and
  // nothing said so. Every other degenerate case in solidForNode returns null;
  // this one now does too.
  if (innerR > 1e-6 && innerR >= outerR - 1e-6) return null;
  const hasBore = innerR > 1e-6 && innerR < outerR - 1e-6;
  const pts = hasBore
    ? [
        new THREE.Vector2(innerR, 0),
        new THREE.Vector2(outerR, 0),
        new THREE.Vector2(outerR, len),
        new THREE.Vector2(innerR, len),
        new THREE.Vector2(innerR, 0), // close the ring's cross-section
      ]
    : [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(outerR, 0),
        new THREE.Vector2(outerR, len),
        new THREE.Vector2(0, len),
      ];
  let geo: THREE.BufferGeometry = new THREE.LatheGeometry(pts, SEGMENTS);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const discTol = meshTolerances(geo);
  geo = dropDegenerate(mergeVertices(geo, discTol.weld), discTol.area);
  geo.rotateZ(-Math.PI / 2); // lathe axial (Y) -> world X
  geo.computeVertexNormals();
  return geo;
}

/** One fin as a flat, watertight extruded solid at the origin (planform in XY,
 *  thickness centered on Z) — ready to lay on a print bed. */
function oneFinSolid(child: ComponentNode, parentRadius: number | null): THREE.BufferGeometry | null {
  const root = finRootChord(child, 0);
  const height = finSpan(child);
  const thickness = num(child, 'thickness', 0.003);

  // Degenerate planform -> no printable solid: a zero-area outline (thickness,
  // root or height <= 0) or a freeform with < 3 points extrudes to a broken /
  // empty mesh. Skip it rather than emit non-manifold garbage into the export.
  if (!(thickness > 0) || !(root > 0) || !(height > 0)) return null;
  // ...nor is a self-crossing one. Same policy as the degenerate cases above:
  // return null so the caller reports "can't be exported" rather than emitting
  // a solid whose faces pass through each other.
  if (child.type === 'freeformfinset' && !isSimplePolygon(freeformPoints(child))) return null;

  // The outline, tab folded in, from the ONE fin-geometry module. This used to
  // sample its own elliptical curve here and got a sine arch instead of the
  // kernel's half-ellipse, so the printed fin was a different shape from the
  // one that flew. See tree/finPlanform.ts.
  const contour = finCutContour(child, parentRadius);
  if (!contour || contour.length < 3) return null;

  const shape = new THREE.Shape();
  shape.moveTo(contour[0]![0], contour[0]![1]);
  for (let i = 1; i < contour.length; i++) shape.lineTo(contour[i]![0], contour[i]![1]);
  shape.closePath();

  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const finTol = meshTolerances(g);
  const welded = dropDegenerate(mergeVertices(g, finTol.weld), finTol.area);
  welded.computeVertexNormals();
  return welded;
}

/**
 * The watertight solid (meters) for a single component, or null when the type
 * has no 3D-printable body. One part, built at the origin — this backs the
 * per-component STL/OBJ/GLB export.
 */
export function solidForNode(node: ComponentNode, parentRadius: number | null = null): THREE.BufferGeometry | null {
  const geo = buildSolid(node, parentRadius);
  if (!geo) return null;
  // The choke point. Every printable solid leaves through here, so it is the
  // one place worth asking whether it is really a solid. `countBoundaryEdges`
  // (used inside makeWatertight) only asks "is every edge used twice", which
  // is satisfied by an EMPTY mesh and by a cap whose triangles overlap facing
  // opposite ways. Both shipped. Returning null makes the caller report "this
  // part can't be exported" instead of writing a file that no slicer can use.
  if (validateSolid(geo, meshTolerances(geo).area).length) return null;
  return geo;
}

function buildSolid(node: ComponentNode, parentRadius: number | null): THREE.BufferGeometry | null {
  const len = num(node, 'length', 0);
  switch (node.type) {
    case 'nosecone': {
      const R = num(node, 'aftRadius', 0.012);
      if (!(R > 0) || !(len > 0)) return null; // zero-radius/length → empty, non-manifold lathe
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
      if (!(len > 0) || !(Math.max(rf, ra) > 0)) return null; // degenerate → no solid
      const shape = typeof node['shape'] === 'string' ? (node['shape'] as string) : 'conical';
      const clipped = typeof node['clipped'] === 'boolean' ? (node['clipped'] as boolean) : undefined;
      let surface = outerProfile(shape, numOpt(node, 'shapeParameter'), len, rf, ra, SEGMENTS, undefined, clipped);
      // Fore/aft shoulders: stubs that plug into the tubes on either side.
      const fShR = num(node, 'foreShoulderRadius', 0),
        fShLen = num(node, 'foreShoulderLength', 0);
      const aShR = num(node, 'aftShoulderRadius', 0),
        aShLen = num(node, 'aftShoulderLength', 0);
      if (fShR > 1e-6 && fShLen > 1e-6) surface = [[-fShLen, Math.min(fShR, rf)], [0, Math.min(fShR, rf)], ...surface];
      if (aShR > 1e-6 && aShLen > 1e-6)
        surface = [...surface, [len, Math.min(aShR, ra)], [len + aShLen, Math.min(aShR, ra)]];
      return revolveSolidX(surface, 0);
    }
    // Tubes — hollow, with their own wall thickness. (Coupler/engine block/rings
    // fit their parent's bore, so they go through resolveDisc, not here.)
    case 'bodytube':
    case 'innertube':
    case 'launchlug':
    case 'tubefinset': {
      // A tube fin set legitimately carries NO outerRadius: the kernel
      // auto-sizes it from the body radius and the fin count
      // (TubeFinSet.getOuterRadius). This used to substitute a hard 12 mm, so a
      // 6-tube set on a 25 mm body exported at less than half its real
      // diameter with no warning. Without a parent radius the size is simply
      // unknowable, so skip the part rather than invent one.
      const R =
        node.type === 'tubefinset'
          ? (numOpt(node, 'outerRadius') ?? (parentRadius != null ? tubeFinRadius(node, parentRadius) : NaN))
          : num(node, 'outerRadius', 0.012);
      const wall = num(node, 'thickness', node.type === 'launchlug' ? 0.0003 : 0.0005);
      // A zero/negative outer radius (or length) revolves to an empty mesh that
      // still reads as "watertight"; return null so it's skipped from export
      // rather than handed over as a hollow non-solid (matches nose/transition/fin).
      if (!(R > 0) || !(len > 0)) return null;
      // A wall at least as thick as the radius has no bore left, and
      // `discSolid` would silently fall through to its no-bore branch and
      // export a SOLID ROD. That is the opposite of the policy two functions
      // up, where an inverted ring returns null precisely so a blocked bore is
      // not shipped without saying so. Reachable from a units slip in a
      // hand-edited .ork (thickness 0.02 against radius 0.012): printed, the
      // part is a 24 mm rod and nothing fits inside it.
      if (!(wall < R)) return null;
      return discSolid(R, R - wall, len);
    }
    case 'trapezoidfinset':
    case 'ellipticalfinset':
    case 'freeformfinset':
      return oneFinSolid(node, parentRadius);
    default:
      return null;
  }
}
