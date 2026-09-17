/**
 * Cluster layouts — an exact mirror of the kernel's ClusterConfiguration
 * (carved info.openrocket.core.rocketcomponent.ClusterConfiguration). Unit
 * points: closest tube centers are distance 1 apart; the physical separation
 * is 2 × tubeOuterRadius × clusterScale. Used for 2D/3D drawing and motor
 * counts — the PHYSICS reads the kernel's own copy, so these only need to
 * match visually.
 */

const SQRT2 = Math.SQRT2;
const SQRT3 = Math.sqrt(3);
const R5 = 1.0 / (2 * Math.sin((2 * Math.PI) / 10));
const ring = (n: number, r: number, centered: boolean): number[] => {
  const pts: number[] = centered ? [0, 0] : [];
  for (let i = 0; i < n; i++) {
    pts.push(r * Math.sin((2 * Math.PI * i) / n), r * Math.cos((2 * Math.PI * i) / n));
  }
  return pts;
};

/** Flat [x0,y0, x1,y1, …] unit points per pattern (kernel XML names). */
export const CLUSTER_POINTS: Record<string, number[]> = {
  single: [0, 0],
  double: [-0.5, 0, 0.5, 0],
  '3-row': [-1, 0, 0, 0, 1, 0],
  '4-row': [-1.5, 0, -0.5, 0, 0.5, 0, 1.5, 0],
  '3-ring': [-0.5, -1 / (2 * SQRT3), 0.5, -1 / (2 * SQRT3), 0, 1 / SQRT3],
  '4-ring': [-0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5],
  '5-ring': ring(5, R5, false),
  '6-ring': [0, 1, SQRT3 / 2, 0.5, SQRT3 / 2, -0.5, 0, -1, -SQRT3 / 2, -0.5, -SQRT3 / 2, 0.5],
  '3-star': [0, 0, 0, 1, SQRT3 / 2, -0.5, -SQRT3 / 2, -0.5],
  '4-star': [0, 0, -1 / SQRT2, 1 / SQRT2, 1 / SQRT2, 1 / SQRT2, 1 / SQRT2, -1 / SQRT2, -1 / SQRT2, -1 / SQRT2],
  '5-star': ring(5, 1, true),
  '6-star': [0, 0, 0, 1, SQRT3 / 2, 0.5, SQRT3 / 2, -0.5, 0, -1, -SQRT3 / 2, -0.5, -SQRT3 / 2, 0.5],
  '9-grid': [-1.4, 1.4, 0, 1.4, 1.4, 1.4, -1.4, 0, 0, 0, 1.4, 0, -1.4, -1.4, 0, -1.4, 1.4, -1.4],
  '9-star': [
    0,
    0,
    1.4,
    0,
    1.4 / SQRT2,
    -1.4 / SQRT2,
    0,
    -1.4,
    -1.4 / SQRT2,
    -1.4 / SQRT2,
    -1.4,
    0,
    -1.4 / SQRT2,
    1.4 / SQRT2,
    0,
    1.4,
    1.4 / SQRT2,
    1.4 / SQRT2,
  ],
};

/**
 * The cluster patterns, in kernel order — the dropdown's option list.
 *
 * Names only: this module is geometry, and the option TEXT is the property
 * panel's business (it localizes it, and builds the motor count from
 * `clusterCount` rather than baking English in here).
 */
export const CLUSTER_OPTIONS: string[] = Object.keys(CLUSTER_POINTS);

/** Motors in this cluster pattern (1 for single/unknown). */
export function clusterCount(cluster: string | undefined): number {
  const pts = CLUSTER_POINTS[cluster ?? 'single'];
  return pts ? pts.length / 2 : 1;
}

/**
 * Physical tube-center offsets (m) in the cross-section plane, rotation applied.
 *
 * The rotation is ClusterConfiguration.getPoints(rotation) verbatim
 * (ClusterConfiguration.java:108-119):
 *
 *     ret.add( x * cos + y * sin);
 *     ret.add(-x * sin + y * cos);
 *
 * — R(−θ). This used to compute `x·cos − y·sin` / `x·sin + y·cos`, which is
 * R(+θ), so every drawn cluster was turned 2θ the wrong way: a 3-ring clocked
 * 30° on 19 mm tubes put its first tube at (−5.48, −9.50) mm where the kernel
 * flies it at (−10.97, 0). The physics never saw it — the kernel keeps its own
 * copy — but the 2D schematic, the 3D model and the aft view all disagreed with
 * what was being flown, and `cluster.test.ts` pinned the wrong sign.
 *
 * Two things InnerTube.getClusterPoints (InnerTube.java:263-273) also does and
 * this does NOT: it rotates by `clusterRotation − radialDirection`, and it adds
 * the `radialPosition` offset. Neither is drawn app-side, so a cluster that is
 * also radially offset still draws on the axis.
 */
export function clusterOffsets(
  cluster: string | undefined,
  tubeOuterRadius: number,
  clusterScale = 1,
  clusterRotation = 0,
): { y: number; z: number }[] {
  const pts = CLUSTER_POINTS[cluster ?? 'single'] ?? [0, 0];
  const separation = 2 * tubeOuterRadius * clusterScale;
  const cos = Math.cos(clusterRotation);
  const sin = Math.sin(clusterRotation);
  const out: { y: number; z: number }[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    // px/py, not x/y: `y: (x * cos - y * sin)` reads as a self-reference, which
    // is how the sign error hid here in the first place.
    const px = pts[i]!;
    const py = pts[i + 1]!;
    out.push({
      y: (px * cos + py * sin) * separation,
      z: (-px * sin + py * cos) * separation,
    });
  }
  return out;
}
