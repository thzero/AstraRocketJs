import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ComponentNode } from '../../src/engine/openRocketEngine';
import {
  KERNEL_ELLIPSE_POINTS,
  ellipticalFinPoints,
  finCutContour,
  finSpan,
  finTabSpan,
  trapezoidFinPoints,
} from '../../src/tree/finPlanform';
import { tubeFinRadius } from '../../src/tree/tubefins';
import { finPlanformMm } from '../../src/services/reportGeometry';

/**
 * DIFFERENTIAL TEST: the ported fin geometry vs the OpenRocket kernel.
 *
 * ## What this guards and why it is shaped this way
 *
 * `web/src/tree` and `web/src/services` re-implement kernel math in TypeScript
 * so the app can draw, print and cut a fin without a round trip through the
 * WASM engine. The `parity` CI job does NOT cover any of it: parity compares
 * the kernel to ITSELF across JVM, TeaVM-JS and WASM-GC. The hand-ports therefore
 * had no gate at all, and an elliptical fin was the wrong curve for twelve days
 * and three audits because every review compared the four copies of the
 * sampler to each other instead of to `EllipticalFinSet.java`.
 *
 * So this file does two things that a normal unit test does not:
 *
 * 1. **Source-drift guard.** It reads the committed Java under
 *    `engine-java/src/java` and asserts the formulas are still the ones the
 *    port was written against. A kernel bump that changes the shape of a fin
 *    fails here, loudly, naming the port to update — rather than letting the
 *    exports drift silently out of step with the simulation.
 *
 * 2. **Independent re-derivation.** The expected values are computed here from
 *    the kernel's own algorithm, transcribed in the kernel's own structure,
 *    NOT by calling the code under test or by copying its output. A test that
 *    asserts the implementation against itself proves nothing, which is the
 *    other half of how the bug survived: the previous test asserted only that
 *    the curve had "more than 10 points" and that its apex reached full
 *    height. A sine arch satisfies both.
 *
 * Any new ported geometry belongs here too. Adding a case is cheap; finding
 * out from a user that their printed part is the wrong shape is not.
 */

const JAVA_ROOT = fileURLToPath(new URL('../../../engine-java/src/java/info/openrocket/core/', import.meta.url));

/** Java source with runs of whitespace collapsed, so the guards survive reformatting. */
function javaSource(relPath: string): string {
  let raw: string;
  try {
    raw = readFileSync(JAVA_ROOT + relPath, 'utf8');
  } catch {
    // Deliberately a failure, not a skip: a gate that silently disables itself
    // when its reference moves is exactly the hole this file was added to fill.
    throw new Error(
      `Kernel reference source not found: engine-java/src/java/info/openrocket/core/${relPath}. ` +
        `The fin-geometry port is verified against it; if the kernel tree moved, update JAVA_ROOT here.`,
    );
  }
  return raw.replace(/\s+/g, ' ');
}

const node = (props: Record<string, unknown>): ComponentNode => ({ id: 'f1', ...props }) as unknown as ComponentNode;

describe('elliptical fin planform vs EllipticalFinSet.java', () => {
  const src = javaSource('rocketcomponent/EllipticalFinSet.java');

  it('is generated from the formulas the port was written against', () => {
    // If any of these fail, the kernel changed the shape of an elliptical fin.
    // Re-derive ellipticalFinPoints() from the new source before touching this.
    expect(src).toContain('double a = Math.PI * (POINTS - 1 - i) / (POINTS - 1);');
    expect(src).toContain('POINT_X[i] = (Math.cos(a) + 1) / 2;');
    expect(src).toContain('POINT_Y[i] = Math.sin(a);');
    expect(src).toContain('POINT_X[0] = 0;');
    expect(src).toContain('POINT_Y[0] = 0;');
    expect(src).toContain('POINT_X[POINTS - 1] = 1;');
    expect(src).toContain('POINT_Y[POINTS - 1] = 0;');
    // getFinPoints scales the unit table by (max(length, 0.0001), height).
    expect(src).toContain('double len = MathUtil.max(length, 0.0001);');
    expect(src).toContain('finPoints[i] = new Coordinate(POINT_X[i] * len, POINT_Y[i] * height);');
  });

  it('samples at the kernel resolution', () => {
    const declared = /private static final int POINTS = (\d+);/.exec(src);
    expect(declared?.[1]).toBeDefined();
    expect(Number(declared![1])).toBe(KERNEL_ELLIPSE_POINTS);
    expect(ellipticalFinPoints(0.05, 0.03)).toHaveLength(KERNEL_ELLIPSE_POINTS);
  });

  it('matches an independent transcription of the kernel algorithm', () => {
    // Transcribed from the Java static block above, in its structure.
    const POINTS = 31;
    const POINT_X: number[] = [];
    const POINT_Y: number[] = [];
    for (let i = 0; i < POINTS; i++) {
      const a = (Math.PI * (POINTS - 1 - i)) / (POINTS - 1);
      POINT_X[i] = (Math.cos(a) + 1) / 2;
      POINT_Y[i] = Math.sin(a);
    }
    POINT_X[0] = 0;
    POINT_Y[0] = 0;
    POINT_X[POINTS - 1] = 1;
    POINT_Y[POINTS - 1] = 0;

    for (const [rootChord, height] of [
      [0.05, 0.03],
      [0.12, 0.004],
      [0.0001, 0.05],
      [0.2, 0.2],
    ] as const) {
      const len = Math.max(rootChord, 0.0001);
      const ours = ellipticalFinPoints(rootChord, height);
      for (let i = 0; i < POINTS; i++) {
        expect(ours[i]![0]).toBeCloseTo(POINT_X[i]! * len, 12);
        expect(ours[i]![1]).toBeCloseTo(POINT_Y[i]! * height, 12);
      }
    }
  });

  it('lies on the half-ellipse, which a sine arch does not', () => {
    const root = 0.05,
      height = 0.03;
    for (const [x, y] of ellipticalFinPoints(root, height)) {
      // (x - root/2)^2 / (root/2)^2 + y^2 / height^2 == 1 for every sample.
      const u = (x - root / 2) / (root / 2);
      const v = y / height;
      expect(u * u + v * v).toBeCloseTo(1, 10);
    }
  });

  it('pins the station that three audits walked past', () => {
    // Closed form at x = 5 mm on a 50 x 30 mm fin: y = h*sqrt(1 - (2x/root - 1)^2) = 18.0 mm.
    // The sine arch that shipped gave 9.27 mm here. This is the regression sentinel:
    // if it ever reads ~9.3 again, a consumer has grown its own sampler.
    const root = 0.05,
      height = 0.03;
    const pts = ellipticalFinPoints(root, height);
    const at5 = pts.reduce((a, b) => (Math.abs(b[0] - 0.005) < Math.abs(a[0] - 0.005) ? b : a));
    const exact = height * Math.sqrt(1 - Math.pow((2 * at5[0]) / root - 1, 2));
    expect(at5[1]).toBeCloseTo(exact, 12);
    expect(height * Math.sqrt(1 - Math.pow((2 * 0.005) / root - 1, 2))).toBeCloseTo(0.018, 4);
  });

  it('keeps the endpoints exactly on the root line', () => {
    const pts = ellipticalFinPoints(0.05, 0.03);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[KERNEL_ELLIPSE_POINTS - 1]).toEqual([0.05, 0]);
  });
});

describe('trapezoid fin planform vs TrapezoidFinSet.java', () => {
  const src = javaSource('rocketcomponent/TrapezoidFinSet.java');

  it('is generated from the formulas the port was written against', () => {
    expect(src).toContain('points.add(Coordinate.NUL);');
    expect(src).toContain('points.add(new Coordinate(sweep, height));');
    expect(src).toContain('if (tipChord > 0.0001) {');
    expect(src).toContain('points.add(new Coordinate(sweep + tipChord, height));');
    expect(src).toContain('points.add(new Coordinate(MathUtil.max(length, 0.0001), 0));');
  });

  it('matches an independent transcription, including the tip-collapse rule', () => {
    const kernelPoints = (rootChord: number, tipChord: number, sweep: number, height: number): number[][] => {
      const points: number[][] = [];
      points.push([0, 0]);
      points.push([sweep, height]);
      if (tipChord > 0.0001) points.push([sweep + tipChord, height]);
      points.push([Math.max(rootChord, 0.0001), 0]);
      return points;
    };
    for (const [rootChord, tipChord, sweep, height] of [
      [0.06, 0.03, 0.03, 0.05],
      [0.05, 0, 0.02, 0.03], // tip collapses -> triangle
      [0.05, 0.00005, 0.02, 0.03], // below the kernel's 0.0001 threshold -> triangle
      [0.00002, 0.02, 0.01, 0.04], // root below the kernel's floor
    ] as const) {
      const n = node({ type: 'trapezoidfinset', rootChord, tipChord, sweep, height });
      expect(trapezoidFinPoints(n)).toEqual(kernelPoints(rootChord, tipChord, sweep, height));
    }
  });
});

describe('tube-fin auto radius vs TubeFinSet.java', () => {
  const src = javaSource('rocketcomponent/TubeFinSet.java');

  it('is generated from the formulas the port was written against', () => {
    expect(src).toContain('final double finSep = Math.PI / fins;');
    expect(src).toContain('r *= Math.sin(finSep) / (1.0 - Math.sin(finSep));');
    // The under-3-fins branch of getOuterRadius().
    expect(src).toContain('if (fins < 3) { return getBodyRadius(); } else { return getTouchingRadius(); }');
  });

  it('matches an independent transcription of getTouchingRadius', () => {
    const touchingRadius = (bodyRadius: number, fins: number): number => {
      let r = bodyRadius;
      const finSep = Math.PI / fins;
      r *= Math.sin(finSep) / (1.0 - Math.sin(finSep));
      return r;
    };
    for (const fins of [3, 4, 5, 6, 8, 12]) {
      const n = node({ type: 'tubefinset', finCount: fins });
      expect(tubeFinRadius(n, 0.025)).toBeCloseTo(touchingRadius(0.025, fins), 12);
    }
  });

  it('falls back to the body radius below three fins, as the kernel does', () => {
    for (const fins of [1, 2]) {
      expect(tubeFinRadius(node({ type: 'tubefinset', finCount: fins }), 0.025)).toBeCloseTo(0.025, 12);
    }
  });

  it('prefers an explicit radius over the auto rule', () => {
    const n = node({ type: 'tubefinset', finCount: 6, outerRadius: 0.011 });
    expect(tubeFinRadius(n, 0.025)).toBe(0.011);
  });
});

describe('through-the-wall tab vs FinSet.java', () => {
  const src = javaSource('rocketcomponent/FinSet.java');

  it('clamps tab height the way the kernel does', () => {
    expect(src).toContain('double maxTabHeight = getMaxTabHeight();');
    expect(src).toContain('this.tabHeight = Math.min(this.tabHeight, maxTabHeight);');
    expect(src).toContain('return MathUtil.min(radiusFront, radiusTrailing);');
  });

  it('never cuts a tab deeper than the body radius', () => {
    // 20 mm tab on a 12 mm-radius body: the kernel caps it at 12 mm. The STL
    // and the 1:1 PDF template both used to cut the full 20 mm, straight
    // through the airframe axis, while the DXF of the same part cut 12 mm.
    const n = node({ type: 'trapezoidfinset', tabHeight: 0.02, tabLength: 0.02, tabOffsetMethod: 'middle' });
    expect(finTabSpan(n, 0.05, 0.012)?.height).toBeCloseTo(0.012, 12);
    expect(finTabSpan(n, 0.05, 0.03)?.height).toBeCloseTo(0.02, 12);
    // No parent radius known -> no clamp, rather than a silent zero.
    expect(finTabSpan(n, 0.05, null)?.height).toBeCloseTo(0.02, 12);
  });

  it('returns null rather than a degenerate tab', () => {
    const noTab = node({ type: 'trapezoidfinset', tabHeight: 0, tabLength: 0.02 });
    expect(finTabSpan(noTab, 0.05, 0.012)).toBeNull();
    const zeroLen = node({ type: 'trapezoidfinset', tabHeight: 0.005, tabLength: 0 });
    expect(finTabSpan(zeroLen, 0.05, 0.012)).toBeNull();
  });
});

/**
 * The recurrence guard.
 *
 * Fixing the four copies is only half the job: the bug came back twice because
 * nothing stopped a consumer from growing its own sampler again, and each new
 * copy looked locally reasonable. Kernel trigonometry is allowed in exactly two
 * modules — this planform port and the tube-fin auto-radius port — and anywhere
 * else it means a fifth copy is being born.
 *
 * If this fails on a legitimate new use, move the math into `tree/` and call it
 * from the consumer. Do not add the consumer to the allowlist.
 */
describe('no module grows its own fin sampler', () => {
  const SRC = fileURLToPath(new URL('..', import.meta.url));
  /** Ports of kernel trig that are allowed to compute it directly. */
  const ALLOWED = ['tree/finPlanform.ts', 'tree/tubefins.ts', 'tree/shapeProfile.ts'];

  const sourceFiles = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const full = dir + entry;
      if (statSync(full).isDirectory()) {
        if (entry !== 'vendor') sourceFiles(full + '/', out);
      } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  };

  it('keeps kernel trigonometry in the ports that own it', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = file.slice(SRC.length).split('\\').join('/');
      if (ALLOWED.includes(rel)) continue;
      if (/Math\.(sin|cos|acos|asin)\(Math\.PI/.test(readFileSync(file, 'utf8'))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * The export paths must describe the SAME part.
 *
 * `finCutContour` backs the STL/OBJ/GLB and the DXF; `finPlanformMm` backs the
 * 1:1 PDF template. They are the two public entry points, and the original bug
 * was precisely that they disagreed. This pins them together for every fin
 * type, so a consumer that stops calling the shared module fails here even if
 * it reintroduces the divergence without any trigonometry of its own.
 */
describe('the cut contour and the printed template are the same part', () => {
  const R = 0.012; // body radius, so the tab clamp is exercised on both paths

  const cases: Record<string, unknown>[] = [
    { type: 'ellipticalfinset', rootChord: 0.05, height: 0.03 },
    { type: 'ellipticalfinset', rootChord: 0.05, height: 0.03, tabHeight: 0.02, tabLength: 0.02 },
    { type: 'trapezoidfinset', rootChord: 0.06, tipChord: 0.03, sweep: 0.03, height: 0.05 },
    { type: 'trapezoidfinset', rootChord: 0.06, height: 0.05 }, // missing tipChord -> shared fallback
    {
      type: 'freeformfinset',
      points: [
        [0.02, 0],
        [0.04, 0.04],
        [0.07, 0],
      ],
    },
  ];

  it.each(cases.map((c) => [String(c['type']) + JSON.stringify(c['tabHeight'] ?? ''), c] as const))(
    'agrees for %s',
    (_label, props) => {
      const n = node(props);
      const contour = finCutContour(n, R);
      const template = finPlanformMm(n, R);
      expect(contour).not.toBeNull();
      // finPlanformMm is the same outline in mm with y measured down from the
      // span: y_mm = (height - y_m) * 1000. Invert it and the two must match.
      const height = finSpan(n);
      const fromTemplate = template.pts.map(([x, y]) => [x / 1000, height - y / 1000]);
      expect(fromTemplate).toHaveLength(contour!.length);
      for (let i = 0; i < contour!.length; i++) {
        expect(fromTemplate[i]![0]).toBeCloseTo(contour![i]![0], 9);
        expect(fromTemplate[i]![1]).toBeCloseTo(contour![i]![1], 9);
      }
    },
  );
});
