import * as THREE from 'three';

/**
 * Is this geometry actually a solid a slicer can print?
 *
 * ## Why this exists
 *
 * `solidMesh` had three separate bugs that all shared one property: **the
 * exporter's own check passed anyway.** `countBoundaryEdges` asks one question,
 * "is every edge used twice", and that question is blind to
 *
 * - a cap fanned from a point outside its own loop, whose triangles overlap and
 *   face opposite ways (a fan always uses each edge twice),
 * - an EMPTY index, which trivially has no unused edges, so a solid whose every
 *   triangle was dropped as degenerate reported success and downloaded as a
 *   0-byte-of-geometry STL,
 * - a planform that touches itself at a point, which extrudes to a non-manifold
 *   pinch where four faces share one vertex.
 *
 * Writing a bespoke assertion for each of those is how a codebase ends up with
 * three divergent copies of the same check. So: one validator, and every
 * exported solid goes through it. Add a check here, and everything that
 * produces a mesh gets it at once.
 *
 * All checks are cheap and topological (O(triangles)); this is not a
 * self-intersection test, which needs spatial indexing and is not worth it for
 * the sizes involved.
 */

export type MeshIssueKind =
  'empty' | 'non-finite' | 'degenerate-triangle' | 'repeated-vertex' | 'non-manifold-edge' | 'inconsistent-winding';

export interface MeshIssue {
  kind: MeshIssueKind;
  /** Human-readable, safe to show in an export error. */
  detail: string;
  /** How many times the problem occurs, where counting makes sense. */
  count?: number;
}

/** Undirected key for an edge between two vertex indices. */
const undirectedKey = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`);

/**
 * Every way `geo` fails to be a closed, consistently oriented, non-degenerate solid.
 * An empty array means it is one.
 *
 * `areaTol` is the smallest triangle area (m^2) that still counts as real. It
 * should be derived from the model's own size (see {@link meshTolerances}), not
 * fixed: the same absolute cut that is right for a 70 mm nose cone erases every
 * triangle of the same cone scaled to 0.2 mm.
 */
export function validateSolid(geo: THREE.BufferGeometry, areaTol = 0): MeshIssue[] {
  const issues: MeshIssue[] = [];
  const pos = geo.getAttribute('position');
  const idx = geo.getIndex();

  if (!pos || pos.count === 0 || !idx || idx.count === 0) {
    return [{ kind: 'empty', detail: 'the solid has no triangles' }];
  }
  if (idx.count % 3 !== 0) {
    issues.push({ kind: 'empty', detail: `index length ${idx.count} is not a whole number of triangles` });
  }

  let nonFinite = 0;
  for (let i = 0; i < pos.count; i++) {
    if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) nonFinite++;
  }
  if (nonFinite) {
    issues.push({
      kind: 'non-finite',
      detail: `${nonFinite} vertex position(s) are NaN or Infinity`,
      count: nonFinite,
    });
  }

  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const ab = new THREE.Vector3(),
    ac = new THREE.Vector3();

  let degenerate = 0;
  let repeated = 0;
  /** Directed edge use count, to separate "shared" from "shared the same way". */
  const directed = new Map<string, number>();
  const undirected = new Map<string, number>();

  for (let i = 0; i < idx.count - 2; i += 3) {
    const ia = idx.getX(i),
      ib = idx.getX(i + 1),
      ic = idx.getX(i + 2);

    if (ia === ib || ib === ic || ic === ia) {
      repeated++;
      continue; // a triangle with a repeated corner has no edges worth counting
    }

    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    const area = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
    if (!(area > areaTol)) degenerate++;

    for (const [u, v] of [
      [ia, ib],
      [ib, ic],
      [ic, ia],
    ] as const) {
      directed.set(`${u}>${v}`, (directed.get(`${u}>${v}`) ?? 0) + 1);
      const k = undirectedKey(u, v);
      undirected.set(k, (undirected.get(k) ?? 0) + 1);
    }
  }

  if (repeated) {
    issues.push({
      kind: 'repeated-vertex',
      detail: `${repeated} triangle(s) use the same vertex twice`,
      count: repeated,
    });
  }
  if (degenerate) {
    issues.push({
      kind: 'degenerate-triangle',
      detail: `${degenerate} triangle(s) have effectively zero area`,
      count: degenerate,
    });
  }

  let open = 0;
  let overused = 0;
  for (const n of undirected.values()) {
    if (n < 2) open++;
    else if (n > 2) overused++;
  }
  if (open || overused) {
    const parts: string[] = [];
    if (open) parts.push(`${open} open`);
    if (overused) parts.push(`${overused} shared by more than two faces`);
    issues.push({
      kind: 'non-manifold-edge',
      detail: `edges not shared by exactly two faces (${parts.join(', ')})`,
      count: open + overused,
    });
  }

  // Orientation: in a consistently wound closed mesh each edge is traversed
  // once in each direction, so no DIRECTED edge may appear twice. This is what
  // catches a cap whose triangles overlap and face opposite ways, which the
  // undirected count above cannot see.
  let flipped = 0;
  for (const n of directed.values()) if (n > 1) flipped++;
  if (flipped) {
    issues.push({
      kind: 'inconsistent-winding',
      detail: `${flipped} edge(s) are traversed the same way by two faces, so the surface is not consistently oriented`,
      count: flipped,
    });
  }

  return issues;
}

/** True when {@link validateSolid} finds nothing wrong. */
export function isValidSolid(geo: THREE.BufferGeometry, areaTol = 0): boolean {
  return validateSolid(geo, areaTol).length === 0;
}

/** One line naming everything wrong with a solid, for an export error message. */
export function describeIssues(issues: MeshIssue[]): string {
  return issues.map((i) => i.detail).join('; ');
}

/**
 * Tolerances derived from the model's OWN size.
 *
 * A fixed 1e-6 m weld tolerance and 1e-12 m^2 degeneracy cut are right for a
 * rocket in meters and catastrophic for the same rocket scaled down: at 0.003x
 * every triangle of a 70 mm nose cone falls under the area cut, all of them are
 * dropped, and an empty mesh passes a boundary-edge count. Scaling both with
 * the bounding-box diagonal keeps the ratio the numbers were chosen for.
 *
 * The diagonal is floored at 1 m so a normal-sized rocket keeps exactly the
 * tolerances it has always had, and this only ever loosens for something huge
 * or tightens for something tiny.
 */
export function meshTolerances(geo: THREE.BufferGeometry): { weld: number; area: number } {
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  const diag = box ? box.min.distanceTo(box.max) : 1;
  const scale = Number.isFinite(diag) && diag > 0 ? Math.min(1, diag) : 1;
  const weld = 1e-6 * scale;
  return { weld, area: weld * weld };
}
